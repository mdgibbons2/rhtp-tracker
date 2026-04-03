require('dotenv').config();
const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

const ASANA_TOKEN = process.env.ASANA_ACCESS_TOKEN;
const PROJECT_GID = process.env.ASANA_PROJECT_GID;
const WORKSPACE_GID = '1201336088791926';
const BASE_URL = 'https://app.asana.com/api/1.0';
const MAPPING_FILE = path.join(__dirname, 'asana-mapping.json');
const DATA_FILE = path.join(__dirname, 'rhtp_results.json');

const SECTION_NAMES = [
  'Submitted',
  'Active - Deadline Soon',
  'Active - Open',
  'Forthcoming',
  'Planned',
  'No Activity',
  'Closed / Monitoring',
];

const CUSTOM_FIELD_DEFS = [
  {
    name: 'Opportunity Status',
    resource_subtype: 'enum',
    enum_options: [
      { name: 'Posted', color: 'green' },
      { name: 'Active (Rolling)', color: 'blue' },
      { name: 'Reopened', color: 'hot-pink' },
      { name: 'Forthcoming', color: 'orange' },
      { name: 'Planned', color: 'yellow-orange' },
      { name: 'No Activity', color: 'cool-gray' },
      { name: 'Closed', color: 'none' },
    ],
  },
  {
    name: 'Vivo Priority',
    resource_subtype: 'enum',
    enum_options: [
      { name: 'High', color: 'red' },
      { name: 'Medium', color: 'yellow-orange' },
      { name: 'Low', color: 'blue' },
      { name: 'Not Assessed', color: 'cool-gray' },
    ],
  },
  {
    name: 'Vivo Eligibility',
    resource_subtype: 'enum',
    enum_options: [
      { name: 'Eligible (Direct)', color: 'green' },
      { name: 'Eligible (Registration Needed)', color: 'yellow-green' },
      { name: 'Requires Local Partner', color: 'yellow-orange' },
      { name: 'Subgrant Only', color: 'orange' },
      { name: 'Not Eligible', color: 'red' },
      { name: 'TBD', color: 'cool-gray' },
    ],
  },
  {
    name: 'Local Partner',
    resource_subtype: 'text',
  },
  {
    name: 'Last Researched',
    resource_subtype: 'date',
  },
  {
    name: 'Next Deadline',
    resource_subtype: 'date',
  },
];

// Vivo-only fields that the sync script should never overwrite
const MANUAL_FIELDS = ['Vivo Priority', 'Vivo Eligibility', 'Local Partner'];

// States where Vivo has already submitted - these go in the "Submitted" section
const SUBMITTED_STATES = [
  'New Jersey',
];

// =============================================================================
// Asana API Helpers
// =============================================================================

let lastRequestTime = 0;
const MIN_DELAY_MS = 150;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function asanaRequest(method, endpoint, body = null) {
  // Throttle
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await sleep(MIN_DELAY_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${ASANA_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };
  if (body) {
    opts.body = JSON.stringify({ data: body });
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const res = await fetch(url, opts);

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '30', 10);
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return asanaRequest(method, endpoint, body);
  }

  const json = await res.json();
  if (json.errors) {
    const msg = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Asana API error (${method} ${endpoint}): ${msg}`);
  }
  return json;
}

async function asanaGet(endpoint) {
  return asanaRequest('GET', endpoint);
}

async function asanaPost(endpoint, body) {
  return asanaRequest('POST', endpoint, body);
}

async function asanaPut(endpoint, body) {
  return asanaRequest('PUT', endpoint, body);
}

async function asanaGetAllPages(endpoint) {
  const results = [];
  let url = endpoint;
  while (url) {
    const json = await asanaRequest('GET', url);
    if (json.data) results.push(...json.data);
    url = json.next_page ? json.next_page.uri : null;
  }
  return results;
}

// =============================================================================
// Data Mapping
// =============================================================================

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDate(dateStr) {
  if (!dateStr) return null;
  // ISO format: 2026-04-01
  const isoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1] + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseFreeTextDates(text) {
  if (!text) return [];
  const dates = [];
  const pattern = /(\w+)\s+(\d{1,2}),?\s+(\d{4})/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const monthStr = match[1].toLowerCase();
    if (MONTHS[monthStr] !== undefined) {
      const d = new Date(parseInt(match[3]), MONTHS[monthStr], parseInt(match[2]));
      if (!isNaN(d.getTime())) dates.push(d);
    }
  }
  return dates;
}

function computeNextDeadline(state) {
  const now = new Date();
  const futureDates = [];

  // From applicationDeadline (free-text)
  for (const d of parseFreeTextDates(state.applicationDeadline)) {
    if (d > now) futureDates.push(d);
  }

  // From nextSteps (clean ISO dates)
  if (state.nextSteps) {
    for (const step of state.nextSteps) {
      if (!step.date || step.isShown === false) continue;
      const d = parseDate(step.date);
      if (d && d > now) futureDates.push(d);
    }
  }

  if (futureDates.length === 0) return null;
  futureDates.sort((a, b) => a - b);
  return futureDates[0];
}

function formatDateISO(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function mapStatusToDropdown(status) {
  if (status === 'Yes') return 'Posted';
  if (status === 'Active (Rolling)') return 'Active (Rolling)';
  if (status === 'Reopened') return 'Reopened';
  if (status.startsWith('Forthcoming')) return 'Forthcoming';
  if (status.startsWith('No - ')) return 'Planned';
  if (status === 'Closed') return 'Closed';
  return 'No Activity';
}

function mapStatusToSection(status, applicationDeadline, nextSteps, stateName) {
  // Submitted states always go to Submitted section regardless of opportunity status
  if (SUBMITTED_STATES.includes(stateName)) return 'Submitted';

  const dropdown = mapStatusToDropdown(status);

  if (['Posted', 'Active (Rolling)', 'Reopened'].includes(dropdown)) {
    const deadlineDates = parseFreeTextDates(applicationDeadline);
    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Also check nextSteps for upcoming deadlines
    if (nextSteps) {
      for (const step of nextSteps) {
        if (step.date && step.isShown !== false) {
          const d = parseDate(step.date);
          if (d) deadlineDates.push(d);
        }
      }
    }

    const hasUpcomingDeadline = deadlineDates.some(
      (d) => d > now && d <= thirtyDaysOut
    );
    return hasUpcomingDeadline ? 'Active - Deadline Soon' : 'Active - Open';
  }

  if (dropdown === 'Forthcoming') return 'Forthcoming';
  if (dropdown === 'Planned') return 'Planned';
  if (dropdown === 'Closed') return 'Closed / Monitoring';
  return 'No Activity';
}

function buildDescription(state) {
  const lines = [];
  lines.push(`Lead Agency: ${state.leadAgency}`);
  if (state.programName) lines.push(`Program: ${state.programName}`);
  if (state.programPageUrl) lines.push(`Program Page: ${state.programPageUrl}`);
  if (state.rhtpEmail) lines.push(`Contact: ${state.rhtpEmail}`);
  if (state.applicationLink) lines.push(`Apply: ${state.applicationLink}`);
  if (state.applicationDeadline) lines.push(`Deadline: ${state.applicationDeadline}`);
  if (state.opportunityType && state.opportunityType !== 'N/A') {
    lines.push(`Opportunity Type: ${state.opportunityType}`);
  }
  return lines.join('\n');
}

// =============================================================================
// Mapping File
// =============================================================================

function loadMapping() {
  if (fs.existsSync(MAPPING_FILE)) {
    return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  }
  return { sections: {}, customFields: {}, states: {} };
}

function saveMapping(mapping) {
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 2) + '\n');
}

// =============================================================================
// Section Management
// =============================================================================

async function ensureSections(mapping) {
  console.log('Setting up sections...');
  const existing = await asanaGetAllPages(
    `/projects/${PROJECT_GID}/sections`
  );

  // Map existing sections by name
  const existingByName = {};
  for (const s of existing) {
    existingByName[s.name] = s.gid;
  }

  // Create missing sections
  for (const name of SECTION_NAMES) {
    if (existingByName[name]) {
      mapping.sections[name] = existingByName[name];
      console.log(`  Section "${name}" already exists`);
    } else {
      const result = await asanaPost(`/projects/${PROJECT_GID}/sections`, {
        name,
      });
      mapping.sections[name] = result.data.gid;
      console.log(`  Created section "${name}"`);
    }
  }

  // Remove the default "Untitled section" if it exists
  if (existingByName['Untitled section']) {
    try {
      await asanaRequest(
        'DELETE',
        `/sections/${existingByName['Untitled section']}`
      );
      console.log('  Removed "Untitled section"');
    } catch (e) {
      console.log('  Could not remove "Untitled section":', e.message);
    }
  }

  return mapping;
}

// =============================================================================
// Custom Field Management
// =============================================================================

async function ensureCustomFields(mapping) {
  console.log('Setting up custom fields...');
  const settings = await asanaGetAllPages(
    `/projects/${PROJECT_GID}/custom_field_settings`
  );

  // Map existing fields by name
  const existingByName = {};
  for (const s of settings) {
    const cf = s.custom_field;
    existingByName[cf.name] = cf;
  }

  for (const def of CUSTOM_FIELD_DEFS) {
    if (existingByName[def.name]) {
      const cf = existingByName[def.name];
      const fieldInfo = { gid: cf.gid };
      if (def.resource_subtype === 'enum' && cf.enum_options) {
        fieldInfo.options = {};
        for (const opt of cf.enum_options) {
          if (opt.enabled !== false) {
            fieldInfo.options[opt.name] = opt.gid;
          }
        }
      }
      mapping.customFields[def.name] = fieldInfo;
      console.log(`  Custom field "${def.name}" already exists`);
    } else {
      // Create at workspace level
      const createBody = {
        name: def.name,
        resource_subtype: def.resource_subtype,
        workspace: WORKSPACE_GID,
      };
      if (def.enum_options) {
        createBody.enum_options = def.enum_options;
      }
      const result = await asanaPost('/custom_fields', createBody);
      const cf = result.data;

      // Add to project
      await asanaPost(`/projects/${PROJECT_GID}/addCustomFieldSetting`, {
        custom_field: cf.gid,
        is_important: true,
      });

      const fieldInfo = { gid: cf.gid };
      if (def.resource_subtype === 'enum' && cf.enum_options) {
        fieldInfo.options = {};
        for (const opt of cf.enum_options) {
          fieldInfo.options[opt.name] = opt.gid;
        }
      }
      mapping.customFields[def.name] = fieldInfo;
      console.log(`  Created custom field "${def.name}"`);
    }
  }

  return mapping;
}

// =============================================================================
// Task Management
// =============================================================================

async function findExistingTasks() {
  console.log('Loading existing tasks from Asana...');
  const tasks = await asanaGetAllPages(
    `/projects/${PROJECT_GID}/tasks?opt_fields=name,memberships.section.name`
  );
  const byName = {};
  for (const t of tasks) {
    byName[t.name] = {
      gid: t.gid,
      sectionName: t.memberships?.[0]?.section?.name || null,
    };
  }
  console.log(`  Found ${tasks.length} existing tasks`);
  return byName;
}

function buildCustomFieldValues(state, mapping) {
  const fields = {};
  const cfMap = mapping.customFields;

  // Opportunity Status
  if (cfMap['Opportunity Status']) {
    const dropdownValue = mapStatusToDropdown(state.fundingOpportunityPosted);
    const optGid = cfMap['Opportunity Status'].options?.[dropdownValue];
    if (optGid) fields[cfMap['Opportunity Status'].gid] = optGid;
  }

  // Last Researched (date fields require { date: "YYYY-MM-DD" } format)
  if (cfMap['Last Researched'] && state.lastUpdated) {
    fields[cfMap['Last Researched'].gid] = { date: state.lastUpdated };
  }

  // Next Deadline
  if (cfMap['Next Deadline']) {
    const nextDeadline = computeNextDeadline(state);
    if (nextDeadline) {
      fields[cfMap['Next Deadline'].gid] = { date: formatDateISO(nextDeadline) };
    }
  }

  return fields;
}

async function syncState(state, mapping, existingTasks) {
  const stateName = state.state;
  const targetSection = mapStatusToSection(
    state.fundingOpportunityPosted,
    state.applicationDeadline,
    state.nextSteps,
    state.state
  );
  const description = buildDescription(state);
  const customFields = buildCustomFieldValues(state, mapping);

  let taskGid;
  const existing = existingTasks[stateName];
  const mappedGid = mapping.states[stateName]?.taskGid;

  if (existing) {
    // Task already exists in Asana
    taskGid = existing.gid;

    // Update task
    await asanaPut(`/tasks/${taskGid}`, {
      notes: description,
      custom_fields: customFields,
    });

    // Move to correct section if needed
    if (existing.sectionName !== targetSection && mapping.sections[targetSection]) {
      await asanaPost(`/sections/${mapping.sections[targetSection]}/addTask`, {
        task: taskGid,
      });
    }

    console.log(`  Updated: ${stateName} -> ${targetSection}`);
  } else if (mappedGid) {
    // We have a mapping but task wasn't found in project listing - verify it exists
    taskGid = mappedGid;
    try {
      await asanaPut(`/tasks/${taskGid}`, {
        notes: description,
        custom_fields: customFields,
      });
      if (mapping.sections[targetSection]) {
        await asanaPost(`/sections/${mapping.sections[targetSection]}/addTask`, {
          task: taskGid,
        });
      }
      console.log(`  Updated (from mapping): ${stateName} -> ${targetSection}`);
    } catch (e) {
      // Task was deleted, recreate
      taskGid = null;
    }
  }

  if (!taskGid) {
    // Create new task
    const result = await asanaPost('/tasks', {
      name: stateName,
      projects: [PROJECT_GID],
      notes: description,
      custom_fields: customFields,
    });
    taskGid = result.data.gid;

    // Move to correct section
    if (mapping.sections[targetSection]) {
      await asanaPost(`/sections/${mapping.sections[targetSection]}/addTask`, {
        task: taskGid,
      });
    }

    console.log(`  Created: ${stateName} -> ${targetSection}`);
  }

  // Initialize state mapping
  if (!mapping.states[stateName]) {
    mapping.states[stateName] = { taskGid, subtasks: {} };
  } else {
    mapping.states[stateName].taskGid = taskGid;
  }

  // Sync subtasks
  await syncSubtasks(state, taskGid, mapping);
}

// =============================================================================
// Subtask Management
// =============================================================================

async function syncSubtasks(state, parentTaskGid, mapping) {
  if (!state.nextSteps || state.nextSteps.length === 0) return;

  // Get existing subtasks
  const existingSubtasks = await asanaGetAllPages(
    `/tasks/${parentTaskGid}/subtasks?opt_fields=name,due_on,completed`
  );
  const existingByName = {};
  for (const st of existingSubtasks) {
    existingByName[st.name] = st;
  }

  const stateMapping = mapping.states[state.state];

  for (const step of state.nextSteps) {
    // Skip entries without dates or soft-deleted entries
    if (!step.date || step.isShown === false) continue;

    const label = step.label;
    if (!label) continue;

    if (existingByName[label]) {
      // Subtask exists, update due date if changed
      const existing = existingByName[label];
      if (existing.due_on !== step.date && !existing.completed) {
        await asanaPut(`/tasks/${existing.gid}`, { due_on: step.date });
      }
      stateMapping.subtasks[label] = existing.gid;
    } else if (!stateMapping.subtasks?.[label]) {
      // Create new subtask
      const result = await asanaPost(`/tasks/${parentTaskGid}/subtasks`, {
        name: label,
        due_on: step.date || null,
      });
      stateMapping.subtasks[label] = result.data.gid;
      console.log(`    + Subtask: ${label} (due ${step.date})`);
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('RHTP Asana Sync');
  console.log('===============\n');

  // Load state data
  console.log('Loading state data...');
  const states = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  console.log(`  Loaded ${states.length} states\n`);

  // Load existing mapping
  const mapping = loadMapping();

  // Ensure project structure
  await ensureSections(mapping);
  console.log();
  await ensureCustomFields(mapping);
  console.log();

  // Save mapping after structure setup (in case task sync fails partway)
  saveMapping(mapping);

  // Find existing tasks
  const existingTasks = await findExistingTasks();
  console.log();

  // Sync each state
  console.log('Syncing states...');
  for (const state of states) {
    await syncState(state, mapping, existingTasks);
  }

  // Save final mapping
  saveMapping(mapping);

  console.log('\nSync complete!');

  // Summary
  const sectionCounts = {};
  for (const state of states) {
    const section = mapStatusToSection(
      state.fundingOpportunityPosted,
      state.applicationDeadline,
      state.nextSteps,
      state.state
    );
    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
  }
  console.log('\nSection distribution:');
  for (const [section, count] of Object.entries(sectionCounts)) {
    console.log(`  ${section}: ${count}`);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
