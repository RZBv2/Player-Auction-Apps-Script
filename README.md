# NBIU Football Players Auction System

A live, manual-bid players auction web app built for **NBIU Indoor Outdoor Games 2026**, organized by the Computer Society, Department of Computer Science and Engineering, NBIU.

It runs entirely on **Google Apps Script + Google Sheets**. Players register through a Google Form, the app pulls the football players out of the responses, and the auction host runs the whole show from one screen: pick a player, set a base price, go live, shout the bids, and record the winner. Team budgets update automatically.

No server, no database, no hosting bill.

---

## Why I built this

Our university event needed a football auction where team captains bid on registered players in front of everyone, like the IPL-style auctions. Spreadsheets and paper slips get messy fast, so I built a small tool that keeps one player on the big screen at a time and tracks every team's purse in the background.

The bidding itself is **verbal and manual** on purpose. The host hears the winning bid and types in the final price and team name. That matched how the actual event was going to run.

---

## Features

**Auction flow**
- Shows one random unsold player at a time, with photo, position, department, batch, student ID and contact number
- Simple status flow per player: `Not Started` → `Ready` → `Live` → `Sold`
- "Return to Auction" resets a sold player and refunds the team's spending
- Confirmation prompts before starting, closing or resetting an auction

**Players**
- Reads players straight from the registration form responses
- Only picks people who chose **Football**, and skips duplicate student IDs
- Converts Google Drive photo links into displayable thumbnails
- "All Players" view to browse everyone and see their auction status

**Teams and budgets**
- Set an initial budget per team from the UI
- `Spent` and `Remaining Purse` update automatically when a player is sold or returned
- Budget dashboard with utilization percentage per team

**Records**
- Auction history table of all sold players
- One-click **CSV export** of the sold-players list
- Everything is stored in Google Sheets, so you can open and audit the data anytime

**Bonus: Meal Token Generator (`Code.gs`)**
- Since the same registration sheet was already there, this script also generates meal tokens for participants (`MEAL-20261004-0001` style), blocks duplicate student IDs, and builds a print-ready sheet of token cards (3 per row)
- Runs on form submit, so tokens appear as people register

---

## Tech stack

| Part | What I used |
|---|---|
| Backend | Google Apps Script (`.gs`) |
| Database | Google Sheets |
| Frontend | Plain HTML, CSS and vanilla JavaScript |
| Registration | Google Forms |
| Hosting | Apps Script Web App |

---

## Project structure

```
.
├── Auction.gs   # Auction backend: players, bids, team budgets, CSV export, web app entry (doGet)
├── Code.gs      # Meal token generator and printable token cards
└── Index.html   # The auction UI (single file, no dependencies)
```

---

## How it works

The spreadsheet uses these sheets:

| Sheet | Purpose |
|---|---|
| `Registration Data` | Google Form responses (created by the form) |
| `Auction` | One row per player with base price, current bid, status, winner, final price |
| `Team Budgets` | Team name, initial budget, spent, remaining purse |
| `Token` / `Printable Token` | Meal token data and print layout (only for `Code.gs`) |

The `Auction` and `Team Budgets` sheets are created automatically when you run the setup function.

**The manual bid process**

1. Click **Next Random Player**
2. Enter the **base price** and save
3. Click **Start Auction** (status becomes `Live`)
4. Bidding happens out loud
5. Enter the **final price** and **winning team name**, then click **Close Auction & Save**
6. The player is marked `Sold` and the team's purse is updated

---

## Setup

### 1. Prepare the Google Form and Sheet

Create a registration form linked to a Google Sheet. The sheet tab should be named `Registration Data` and the form should ask for at least:

- Name
- Department Name
- Batch
- Student ID
- Contact Number
- Which sports the person wants to play (must include **Football** as an option)
- Preferred football position
- Football player photo

The script matches column headers loosely (ignoring case, spaces and symbols), and a few alternative header names are supported. Check the config at the top of `Auction.gs` if your headers differ.

### 2. Create the Apps Script project

1. Open your Google Sheet, then go to **Extensions → Apps Script**
2. Add three files and paste in the code:
   - `Auction.gs`
   - `Code.gs` (optional, only if you want meal tokens)
   - `Index.html`
3. In `Auction.gs`, replace the `spreadsheetId` inside `AUCTION_CONFIG` with your own sheet's ID. Do the same in `Code.gs` if you use it

> The spreadsheet ID is the long string in the sheet URL between `/d/` and `/edit`.

### 3. Run the setup

In the Apps Script editor, select `setupAuctionSystem` and click **Run**. Approve the permissions when Google asks. This creates the `Auction` and `Team Budgets` sheets.

If you are using meal tokens, also run `setupMealTokenAutomation` once. It creates the form-submit trigger.

### 4. Deploy as a web app

1. Click **Deploy → New deployment → Web app**
2. Execute as: **Me**
3. Who has access: see the security note below
4. Copy the web app URL and open it on the projector or host laptop

---

## Using it on auction day

1. Open the web app and go to **Team Budgets**. Add every team with its starting budget
2. Click through players with **Next Random Player**
3. Run the auction as described above
4. Use **Auction History** to see results, and download the CSV at the end
5. Made a mistake? Use **Return to Auction** on that player and it undoes the sale and the team's spending

---

## Security notes

- This app shows student **contact numbers** and has no login of its own. Deploy it so only you (or your organization) can open it, not "Anyone"
- Don't commit your real spreadsheet ID or any real registration data to a public repository
- All actions run as the account that deployed the script

---

## Known limitations

Being upfront about what it doesn't do:

- Bidding is manual. There is no live bidding from team screens
- It does not stop a team from going over budget. A negative remaining purse just shows up in red
- Team names are typed in by hand, so a typo creates a new team row. Keep spelling consistent
- The random order is not saved. Refreshing the page starts the random shuffle again (sold players stay sold)
- Built for football only, but the player filter can be changed for other sports

---

## Ideas for later

- Team dropdown instead of typing the team name
- Budget check before closing an auction
- A separate public display screen for the audience
- Support for other sports

---

## About

Built by  **RZBv2**  for the Computer Society, NBIU, as part of NBIU Indoor Outdoor Games 2026.

Department of Computer Science and Engineering, North Bengal International University.

Feel free to fork it and adapt it for your own event.