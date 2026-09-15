# RHTP Vendor/Subaward Application Tracker

## RHTPAnalyst Skill — READ THIS FIRST

This section contains hard-won rules and institutional knowledge. Follow these EVERY time you research or update RHTP data.

### Rule 1: NEVER Hallucinate Links
- **Do NOT invent, guess, or construct URLs.** Only use URLs you have actually verified exist.
- If you find a URL via web search, verify it loads before putting it in the data.
- If WebFetch returns 403/404, that does NOT mean the URL is bad — see Rule 2.
- If you cannot verify a URL exists, leave the field empty rather than guessing.

### Rule 2: Use Playwright for Bot-Blocked Sites
- **Many state .gov sites block automated requests** (WebFetch/curl). They return 403 or 404 to bots but work fine in a real browser.
- Known bot-blocked sites: Ohio (odh.ohio.gov), Minnesota (health.state.mn.us), Vermont (healthcarereform.vermont.gov), New Hampshire (dhhs.nh.gov), Michigan (michigan.gov), New York (health.ny.gov), Kentucky (ruralhealthplan.ky.gov — SharePoint).
- **When WebFetch returns 403/404, try Playwright** before concluding a URL is broken:
  ```bash
  npx playwright open <url>  # Opens a real browser
  ```
  Or use headless mode to check programmatically:
  ```bash
  node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch(); const p = await b.newPage(); const r = await p.goto('URL_HERE'); console.log(r.status()); console.log(await p.title()); await b.close(); })()"
  ```
- **Always verify via Google search** as a secondary check: if Google indexes the URL, it exists.
- **When in doubt, ask the user** before removing or replacing a URL.

### Rule 3: Two Types of "Applications" — Know the Difference

There are two entirely different "applications" in this project. **Never confuse them.**

#### State Application (to CMS) — COMPLETED, DONE, STOP LOOKING
The application each state submitted to CMS to receive their RHTP funding. All 50 states submitted these in late 2025 and all were awarded on December 29, 2025. We have PDFs linked for 48/50 states in the `cmsApplicationUrl` field. **This is done. We are not looking for these anymore.**

Identifying markers: "Project Narrative," "CMS Application," "Grant Application to CMS," budget narratives submitted Nov 2025.

#### Vendor Application (from states to vendors) — THIS IS WHAT WE TRACK
The RFA/RFP/NOFO/subgrant application that each state publishes so that vendors, providers, and partners can apply for a share of the state's RHTP funding. **This is the whole point of the tracker.** Most states haven't posted theirs yet.

Identifying markers: "RFA," "RFP," "NOFO," "Grant Application" or "Subgrant Application" directed at providers/vendors/partners, with deadlines for vendors to submit proposals.

#### How they map to data fields
| Concept | JSON Fields | Purpose |
|---------|------------|---------|
| **State Application** (done) | `cmsApplicationUrl` | Link to the state's CMS project narrative PDF — already collected |
| **Vendor Application** (tracking) | `fundingOpportunityPosted`, `opportunityType`, `applicationOpenDate`, `applicationDeadline`, `applicationLink`, `vendorEligible` | Whether the state has published a way for vendors to apply |

When researching, if you find a PDF on a state's site, determine which type it is. A "Project Narrative" or "CMS Application" is a **State Application** (already have it). An "RFA," "RFP," "NOFO," "Grant Application," or "Subgrant Application" directed at providers/vendors is a **Vendor Application** (this is what we want).

### Rule 4: Check PDFs, Presentations, and Upcoming Events
- **Key details are often in PDFs, not on the web page.** States frequently post stakeholder presentations, webinar slides, town hall decks, and FAQ documents as PDFs linked from their program pages and sub-pages.
- These PDFs often contain timelines, funding breakdowns, eligibility criteria, and application instructions that aren't shown on the HTML page itself.
- Always look for PDF links on the program page and its sub-pages, and read through them.
- **Actively search for upcoming webinars, town halls, stakeholder meetings, listening sessions, and info sessions.** These events are high-priority because they often signal upcoming RFAs and give vendors early engagement opportunities. Add any with specific dates to `nextSteps`. Search: `"[state] rural health transformation" webinar OR "town hall" OR "stakeholder" 2026`.
- Example: Indiana's detailed March 1 application timeline was in a statewide presentation PDF linked from a sub-page (`in.gov/grow-rural-health/regional-grants/`), not on the main program page.
- Example: Pennsylvania's RHTP webinar was listed on their program page (`pa.gov/agencies/dhs/programs-services/healthcare/rural-health`) but was missed because the research didn't specifically search for event dates.

### Rule 5: Always Update Dates
- When you change ANY field on a state record, set `lastUpdated` to today's date in ISO format.
- When you update the data overall, update the footer date in `index.html` (line ~593).

### Rule 6: State-Specific Quirks
- **Minnesota** uses `health.state.mn.us` (not `health.mn.gov`). Grants sub-page: `/facilities/ruralhealth/ruraltrans/grants.html`.
- **Virginia's RHTP page** is on `dmas.virginia.gov` (DMAS is lead agency), not `hhr.virginia.gov`.
- **Delaware's RHTP page** is on the DHSS Division of Public Health site (`dhss.delaware.gov/dph/rural-health-transformation-program/`), which lists all 15 initiatives with Year 1 budgets. It replaced the governor's press release we used as a placeholder before the state had a dedicated page.
- **South Carolina's RHTP content** lives within their general grants page (`scdhhs.gov/resources/grants`), not a standalone page.
- **Kentucky** uses a SharePoint site (`ruralhealthplan.ky.gov`) that blocks all bots with 403.
- **Ohio** has a dedicated solicitation reference documents page at `odh.ohio.gov/know-our-programs/rural-health-transformation-program/solicitation-reference-documents` — check this for new RFPs.

### Rule 7: Data Integrity
- **Pull from Firebase FIRST** before making any changes (the web UI may have manual edits not in git).
- **Never skip the review step.** Always present changes to the user before pushing to Firebase.
- **Preserve existing data.** Only change fields that have actually changed.
- **Back up before updating.** Create a timestamped backup in `backups/` before every research run.

---

## Project Overview
This project tracks downstream vendor, subgrantee, and partner opportunities from the **CMS Rural Health Transformation Program (RHTP)** across all 50 US states. The RHTP was established under the Bipartisan Budget Act (Section 4101, "Making Rural America Healthy Again") and awarded approximately **$10 billion** in FY2026 funding to all 50 states on **December 29, 2025**. Individual state awards range from ~$147M (New Jersey) to ~$281M (Texas).

The tracker is built for **Vivo** (viravivoai) to monitor which states are soliciting applications from vendors, subgrantees, and partners for proposals to be part of the solutions in their state's RHTP implementation.

## What We Built
A single-page interactive web application (`index.html`) hosted on **GitHub Pages** that displays a sortable, filterable DataTable of all 50 states with their RHTP status, award amounts, opportunity details, and contact information.

### Key Features
- **DataTables** (v2.2.2) with Responsive extension for mobile support
- **Filterable** by opportunity status (Posted, Imminent, Planned, No Opportunity Yet) and vendor eligibility
- **Expandable rows** showing detailed info: Program Name, Address, Apply URL, CMS Application PDF, RHTP Email, Notes, Last Updated
- **Edit modal** with inline editing of all fields per state
- **Firebase Realtime Database** - live data stored in Firebase (`rhtp-c8646-default-rtdb.firebaseio.com/states.json`), with authenticated writes (Firebase Auth email/password)
- **Excel export** (XML-based .xls) with color-coded status rows
- **Stats bar** showing counts: Posted, Imminent, Planned
- **GitHub Actions** workflow for daily cleanup of old Pages deployment artifacts

## Data Structure
All state data lives in `rhtp_results.json` (50 entries). Each state record contains:

| Field | Description |
|-------|-------------|
| `state` | State name |
| `programPageUrl` | URL to the state's RHTP program page |
| `fundingOpportunityPosted` | Status: Yes, Active (Rolling), Reopened, Forthcoming, Closed, No, No - RFA/RFP Planned, No - Competitive Process Planned, No - Interest Form Available, No - Notifications Expected |
| `opportunityType` | Type of opportunity (RFA, RFP, Subgrant, etc.) |
| `vendorEligible` | Yes or TBD |
| `applicationOpenDate` | When applications open |
| `applicationDeadline` | Deadline for applications |
| `applicationLink` | Direct link to apply |
| `awardAmount` | State's FY2026 award (e.g., "$281,319,361") |
| `leadAgency` | State agency leading RHTP implementation |
| `notes` | Detailed research notes about the state's status |
| `cmsApplicationUrl` | Link to state's CMS application/project narrative PDF |
| `rhtpEmail` | State's RHTP-specific contact email |
| `programName` | Custom/branded program name (e.g., "Rural Texas Strong") |
| `programAddress` | Mailing address of the lead agency |
| `lastUpdated` | ISO date of last record update |

## Research Completed

### Phase 1: Initial 50-State Research
- Researched all 50 states' RHTP status, lead agencies, award amounts, and opportunity details
- Found program page URLs for all states (some are generic agency pages, others are RHTP-specific)
- Categorized each state's downstream opportunity status

### Phase 2: RHTP-Specific URLs
- Updated 21 states with RHTP-specific program page URLs (replacing generic agency homepages)

### Phase 3: CMS Applications & Emails
- Found CMS application/project narrative PDFs for 48/50 states
- Found RHTP-specific inquiry emails for 26/50 states
- Data sourced from state .gov sites, CMS, SHVS, and public records

### Phase 4: Program Names & Addresses
- Added custom/branded program names for all 50 states (e.g., Georgia's "GREAT Health Program", Texas's "Rural Texas Strong", Indiana's "GROW: Cultivating Hoosier Health")
- Added mailing addresses for the lead agency in each state

### Phase 5: UI/UX Refinements
- Added DataTables Responsive for mobile views
- Moved detailed fields (Notes, Email, CMS App, Program Name, Address) to expandable child rows
- Added expand arrow (collapsed/expanded) UX
- Added Forthcoming badge styling (dark), Active (Rolling) badge (blue), Reopened badge (hot pink)
- Added inline edit modal with data persistence
- Added per-record `lastUpdated` tracking
- Removed "None Yet" from stats bar

### Phase 6: URL Audit (Feb 7, 2026)
- Verified all 50 state program page URLs
- Fixed: Minnesota (wrong domain), Virginia (page moved to DMAS), Delaware (page removed)
- Confirmed Ohio, Vermont, NH, MI, NY, KY are bot-blocked but valid in browsers

## File Structure
```
├── index.html                              # Main app (HTML + CSS + JS, all-in-one)
├── rhtp_results.json                       # Local fallback data for all 50 states
├── CLAUDE.md                               # This file (RHTPAnalyst Skill + project docs)
├── UpdateData.md                           # Step-by-step data update procedure
├── backups/                                # Timestamped backups before each update
├── .gitignore                              # Excludes .claude/, CLAUDE.md, UpdateData.md, backups/
└── .github/workflows/cleanup-artifacts.yml # Daily artifact cleanup for GitHub Pages
```

## Hosting & Repositories
- **Primary repo (personal):** github.com/mdgibbons2/rhtp-tracker (origin)
- **Vivo org repo:** github.com/viravivoai/rhtp-tracker (vivo remote)
- **GitHub Pages:** Served from the repo's main branch via `index.html`
- **Live data:** Firebase Realtime Database (`https://rhtp-c8646-default-rtdb.firebaseio.com/states.json`). Reads are public. Writes require Firebase Auth (email/password, UID: `GRRCcm5pnoZC35uD3dOUpbS2XxH2`).

## Key States to Watch (as of Feb 7, 2026)
States with active or imminent downstream opportunities:
- **Iowa** — POSTED (first state to award vendor funding, $78.6M+ via multiple RFPs)
- **Ohio** — POSTED (Workforce Pipeline RFP, deadline March 10, 2026)
- **New Jersey** — POSTED (RFA closed Jan 20, now in review/award phase)
- **Alaska** — Imminent, portal for LOI expected Feb 2026
- **Indiana** — Imminent, regional grants open March 1, deadline July 1
- **North Dakota** — Imminent, subaward grants slipped from Jan to Feb-Mar 2026
- **Tennessee** — Imminent, competitive opportunities "in upcoming weeks"
- **Utah** — Imminent, RFPs overdue from January 2026
- **Colorado** — RFA in development, advisory committee apps open through Feb 16
- **Oregon** — RFGA planned Spring 2026
- **Texas** — Competitive grants planned Spring 2026 (largest state award: $281M)
- **Montana** — Competitive bidding planned ~March 2026
- **North Carolina** — RFA forthcoming after March office stand-up
- **Arizona** — NOFOs/RFPs likely March/April 2026
- **Missouri** — RFIs Q1 2026, RFPs Q3 2026

## Data Update Procedure
See **[UpdateData.md](UpdateData.md)** for the full step-by-step procedure to refresh state data. The user may say "update the data using the procedures outlined in UpdateData.md" — follow that document exactly.

## Web Research Permissions
This project has full permission to access any websites, APIs, and online resources:
- Fetch content from any URL
- Search any domain
- Make API calls to public endpoints
- Download and process web content
- Scrape publicly accessible data
- Use Playwright browser automation for bot-blocked sites

## Research Guidelines
- Respect robots.txt when scraping at scale
- Use rate limiting for repeated requests
- Cache results to avoid redundant fetches
- Cite sources in findings
- Primary data sources: state .gov program pages, CMS.gov, SHVS (statehealthvaluestrategies.com), Rural Health Information Hub
    f