"""Parse five-field cron expressions and work out when they next fire.

Accepts what Vixie cron and its descendants accept in the schedule fields:

    *                every value
    5                one value
    1-5              a range
    */15  1-30/5     a step over every value, or over a range
    10/15            a step starting at a value and running to the maximum
    1,15,30          a list of any of the above
    JAN-DEC SUN-SAT  names for months and weekdays, in any case
    @hourly @daily @midnight @weekly @monthly @yearly @annually

Day of week runs 0-7, and both 0 and 7 are Sunday.

The rule that is easy to get wrong: when day-of-month and day-of-week are both
restricted, a day matches if EITHER matches, so "0 0 1,15 * MON" fires on the
1st, the 15th and every Monday. When either field starts with `*`, only the
other one counts, and that includes a stepped `*/2`. Surprising, but it is what
cron has always done, and a schedule copied from a crontab has to mean here
what it meant there.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

MACROS = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

# Name, lowest value, highest value and the names that stand for values,
# counted from the lowest, for each field in the order they are written.
FIELDS = [
    ("minute", 0, 59, []),
    ("hour", 0, 23, []),
    ("day of month", 1, 31, []),
    ("month", 1, 12, MONTHS),
    ("day of week", 0, 7, WEEKDAYS),
]

# Every day of the year that exists comes round again within eight years: 29
# February skips 2100, so 2096 to 2104 is the longest wait. A schedule that
# has not fired by then never will, like "0 0 30 2 *".
LONGEST_WAIT_YEARS = 8


@dataclass(frozen=True)
class Schedule:
    minutes: frozenset
    hours: frozenset
    days: frozenset
    months: frozenset
    weekdays: frozenset  # 0 is Sunday; a 7 in the expression is stored as 0
    days_restricted: bool
    weekdays_restricted: bool

    @classmethod
    def parse(cls, expression):
        text = MACROS.get(expression.strip().lower(), expression)
        fields = text.split()
        if len(fields) != 5:
            raise ValueError(f"expected 5 fields, got {len(fields)}: {expression!r}")
        minutes, hours, days, months, weekdays = (
            _parse_field(field, *spec) for field, spec in zip(fields, FIELDS)
        )
        return cls(
            minutes=minutes,
            hours=hours,
            days=days,
            months=months,
            weekdays=frozenset(day % 7 for day in weekdays),
            days_restricted=not fields[2].startswith("*"),
            weekdays_restricted=not fields[4].startswith("*"),
        )

    def matches(self, moment):
        """Whether the schedule fires in the minute `moment` falls in."""
        return (
            moment.minute in self.minutes
            and moment.hour in self.hours
            and moment.month in self.months
            and self._day_matches(moment)
        )

    def next_after(self, moment):
        """The first minute strictly after `moment` that the schedule fires in.

        `moment` is a naive datetime on the wall clock the schedule is meant
        for. Rather than stepping a minute at a time, which is half a million
        steps to reach a yearly job, each field that does not match skips to
        the start of the next month, day or hour.
        """
        candidate = moment.replace(second=0, microsecond=0) + timedelta(minutes=1)
        last_year = candidate.year + LONGEST_WAIT_YEARS
        while candidate.year <= last_year:
            if candidate.month not in self.months:
                candidate = _start_of_next_month(candidate)
            elif not self._day_matches(candidate):
                candidate = (candidate + timedelta(days=1)).replace(hour=0, minute=0)
            elif candidate.hour not in self.hours:
                candidate = (candidate + timedelta(hours=1)).replace(minute=0)
            elif candidate.minute not in self.minutes:
                candidate += timedelta(minutes=1)
            else:
                return candidate
        raise ValueError("the schedule never fires")

    def upcoming(self, moment, count):
        """The next `count` times the schedule fires after `moment`."""
        times = []
        for _ in range(count):
            moment = self.next_after(moment)
            times.append(moment)
        return times

    def _day_matches(self, moment):
        in_month = moment.day in self.days
        in_week = moment.isoweekday() % 7 in self.weekdays
        if self.days_restricted and self.weekdays_restricted:
            return in_month or in_week
        return in_month and in_week


def _parse_field(text, name, lowest, highest, names):
    values = set()
    for part in text.split(","):
        span, slash, step_text = part.partition("/")
        step = _number(step_text, name) if slash else 1
        if step < 1:
            raise ValueError(f"{name}: a step must be at least 1, got {part!r}")
        if span == "*":
            start, end = lowest, highest
        else:
            first, dash, last = span.partition("-")
            start = _value(first, name, lowest, highest, names)
            # "10/15" means from 10 to the maximum, in steps of 15.
            end = _value(last, name, lowest, highest, names) if dash else (highest if slash else start)
        if start > end:
            raise ValueError(f"{name}: {span!r} runs backwards")
        values.update(range(start, end + 1, step))
    return frozenset(values)


def _value(text, name, lowest, highest, names):
    upper = text.upper()
    if upper in names:
        return names.index(upper) + lowest
    value = _number(text, name)
    if not lowest <= value <= highest:
        raise ValueError(f"{name}: {value} is outside {lowest}-{highest}")
    return value


def _number(text, name):
    if not text.isdecimal():
        raise ValueError(f"{name}: expected a number, got {text!r}")
    return int(text)


def _start_of_next_month(moment):
    if moment.month == 12:
        return moment.replace(year=moment.year + 1, month=1, day=1, hour=0, minute=0)
    return moment.replace(month=moment.month + 1, day=1, hour=0, minute=0)


if __name__ == "__main__":
    import sys

    schedule = Schedule.parse(sys.argv[1])
    for when in schedule.upcoming(datetime.now(), int(sys.argv[2]) if len(sys.argv) > 2 else 5):
        print(when.strftime("%a %Y-%m-%d %H:%M"))
