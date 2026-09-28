#!/usr/bin/env python3
"""Monthly revenue per region from an orders export.

    sales_report.py orders.csv > report.csv
    sales_report.py orders.csv --since 2024-01

The export has one row per order line: order_id, date (YYYY-MM-DD), region,
quantity, unit_price. Refunds arrive as negative quantities dated the day of
the refund, so they net off in the month they were paid back, which is what
the accounts show too.
"""

import argparse
import csv
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal


def monthly_revenue(rows, since=None):
    """{(region, "YYYY-MM"): revenue} for every month from `since` on."""
    revenue = defaultdict(Decimal)
    for row in rows:
        month = date.fromisoformat(row["date"]).strftime("%Y-%m")
        if since and month < since:
            continue
        # Decimal, not float: a column of prices summed as floats is off by a
        # cent often enough that the totals row stops matching the invoices.
        revenue[row["region"].strip(), month] += int(row["quantity"]) * Decimal(row["unit_price"])
    return revenue


def write_report(revenue, out):
    """One row per region and one column per month, with totals both ways."""
    regions = sorted({region for region, _ in revenue})
    months = sorted({month for _, month in revenue})
    writer = csv.writer(out)
    writer.writerow(["region", *months, "total"])
    for region in regions:
        cells = [revenue.get((region, month), 0) for month in months]
        writer.writerow([region, *(f"{cell:.2f}" for cell in cells), f"{sum(cells):.2f}"])
    totals = [sum(revenue.get((region, month), 0) for region in regions) for month in months]
    writer.writerow(["total", *(f"{total:.2f}" for total in totals), f"{sum(totals):.2f}"])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Monthly revenue per region.")
    parser.add_argument("orders", help="the orders CSV export")
    parser.add_argument("--since", metavar="YYYY-MM", help="leave out months before this one")
    args = parser.parse_args(argv)

    with open(args.orders, newline="") as handle:
        revenue = monthly_revenue(csv.DictReader(handle), args.since)
    write_report(revenue, sys.stdout)


if __name__ == "__main__":
    main()
