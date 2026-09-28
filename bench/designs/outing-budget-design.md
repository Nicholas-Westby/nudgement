# Outing budget: design

Date: 2026-09-26. Status: approved by Robin in chat.

## Intent

Robin and Sam keep a spreadsheet per outing to see whether they are over budget, and it drifts from
what they actually booked in Fieldmark. A budget per outing, kept next to the sites, lets them see at
a glance what is booked, what is planned, and how much is left, without a second file.

## Scope

In v1: one budget per outing in one currency, expenses with an amount, a category and an optional
site, a summary at the top of the Budget view, and the budget visiting with a shared outing.

Not in v1: several currencies or exchange rates, splitting costs between people, receipts or
photos of receipts, importing bank statements, charts.

## What people see

### The Budget view

- `ViewMode.budget`, after Route in the View picker, symbol `creditcard`, title "Budget".
- At the top, three numbers in a row: "Budget", "Spent" and "Left". "Left" turns red
  (`systemRed`) when it is below zero and reads "Over by €120" instead of "-€120".
- Below, the expenses grouped by category in the outing's category order, newest first inside a
  group. Each row shows the description, the site's name when there is one, the date, and the
  amount right-aligned with monospaced digits.
- An empty budget shows "No expenses yet. Add one with ⌘E." centred in the list.

### Adding and editing

- ⌘E or the + button opens a sheet with: Description (required, at most 80 characters), Amount
  (required, greater than 0, at most 1,000,000, two decimal sites), Category (the outing's
  categories, default "Other"), Site (optional, the outing's sites), Date (default today).
- Save is disabled until Description and Amount are valid. An invalid amount shows "Enter an
  amount like 42.50." under the field.
- Double-clicking a row opens the same sheet for that expense. Delete (⌫) removes the selected
  expenses after a confirmation naming how many: "Delete 3 expenses?".
- The budget total is set by clicking "Budget" at the top; an empty total hides "Left".

### Currency

The outing's currency is chosen once, the first time the Budget view opens (a pop-up of ISO 4217
codes, default the Mac's locale currency). Amounts are formatted with that code in the Mac's
locale. Changing it later relabels amounts; it never converts them.

## Data model

- `<survey>/budget.json` through `JSONFile` (sorted keys, ISO 8601, atomic write):
  `{"currency": "EUR", "total": "2500.00", "expenses": [{"id", "description", "amount",
  "category", "siteId", "date", "createdBy", "editedAt"}]}`.
- Amounts are stored as decimal strings and handled as `Decimal`, never `Double`.
- A missing file is an empty budget. A file that does not decode opens read-only with the bar
  "This budget can't be read, so it's shown read-only to keep it safe." and is never written.
- Deleting a site keeps its expenses and clears their `siteId`.

## Sharing

Each expense is one row of a new entity kind `expense`; the total and currency are one row of kind
`budget`. Both are last-writer-wins by `editedAt`, like kit items. Until the server lists the
kinds, the rows wait in the outbox, as Field Notes rows do.

## Testing

- Core: `Decimal` parsing of amounts ("42.5", "42,50" in a German locale, "1e3" rejected), the JSON
  round outing, the read-only rule, site deletion.
- UI: the sheet's validation messages, "Over by" formatting, the empty state, ⌘E.
- Sharing: an expense added on one Mac appears on the other through the fake server.
