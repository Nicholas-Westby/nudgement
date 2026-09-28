"""Monthly stall fees for the Saturday farmers' market.

Reads the pitch bookings exported from the market office spreadsheet, works out
what each trader owes, emails them, and writes the treasurer's summary.
"""

import csv
import smtplib
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal
from email.message import EmailMessage

PITCH_RATES = {"small": Decimal("18.00"), "standard": Decimal("26.00"), "corner": Decimal("32.00")}
ELECTRICITY = Decimal("6.50")
SMTP_HOST = "mail.market.local"


def read_bookings(path):
    with open(path, newline="") as f:
        return [row for row in csv.DictReader(f) if row["status"] != "cancelled"]


def fees_by_trader(bookings):
    owed = defaultdict(Decimal)
    for row in bookings:
        fee = PITCH_RATES[row["pitch"]]
        if row["power"] == "yes":
            fee += ELECTRICITY
        owed[(row["trader"], row["email"])] += fee
    return owed


def send_invoices(owed, month):
    with smtplib.SMTP(SMTP_HOST) as smtp:
        for (trader, email), total in sorted(owed.items()):
            message = EmailMessage()
            message["From"] = "treasurer@market.local"
            message["To"] = email
            message["Subject"] = f"Stall fees for {month:%B %Y}"
            message.set_content(
                f"Hello {trader},\n\nYour stall fees for {month:%B} come to £{total}.\n"
                "Please pay by bank transfer before the first market of next month.\n"
            )
            smtp.send_message(message)


def write_summary(owed, bookings, month, path):
    pitches = defaultdict(int)
    for row in bookings:
        pitches[row["pitch"]] += 1
    with open(path, "w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["month", month.isoformat()])
        out.writerow(["traders", len(owed)])
        out.writerow(["total", sum(owed.values(), Decimal(0))])
        for pitch, count in sorted(pitches.items()):
            out.writerow([f"{pitch} pitches", count])


def rename_pitch(bookings_path, old, new):
    with open(bookings_path, newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        if row["pitch"] == old:
            row["pitch"] = new
    with open(bookings_path, "w", newline="") as f:
        out = csv.DictWriter(f, fieldnames=rows[0].keys())
        out.writeheader()
        out.writerows(rows)


def main():
    if sys.argv[1] == "rename-pitch":
        rename_pitch(sys.argv[2], sys.argv[3], sys.argv[4])
        return
    month = date.fromisoformat(sys.argv[2] + "-01")
    bookings = read_bookings(sys.argv[1])
    owed = fees_by_trader(bookings)
    send_invoices(owed, month)
    write_summary(owed, bookings, month, f"summary-{month:%Y-%m}.csv")


if __name__ == "__main__":
    main()
