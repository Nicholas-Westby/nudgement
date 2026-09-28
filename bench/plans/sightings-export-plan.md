# Sightings export Implementation Plan

**Goal:** `birdlog export` writes a county recorder's CSV of a year's sightings.

**Spec:** `docs/specs/2026-05-03-sightings-export-design.md`

## Global Constraints

- Python 3.12, standard library only. Tests with `pytest`; run them with `uv run pytest`.
- Dates in the CSV are `DD/MM/YYYY`, as the county recorder's template asks.

### Task 1: One sighting as a CSV row

**Files:**
- Create: `birdlog/export.py`
- Test: `tests/test_export.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_row_uses_recorder_columns():
    s = Sighting(species="Little Egret", count=3, seen_on=date(2026, 4, 18), site="Hayle Estuary", grid_ref="SW5537")
    assert export_row(s) == ["Little Egret", "3", "18/04/2026", "Hayle Estuary", "SW5537", ""]

def test_row_writes_present_for_an_uncounted_flock():
    s = Sighting(species="Starling", count=None, seen_on=date(2026, 1, 9), site="Marazion Marsh", grid_ref="SW5131")
    assert export_row(s)[1] == "present"
```

- [ ] **Step 2: Run to see them fail** — `uv run pytest tests/test_export.py`. Expected: FAIL, `export_row` is not defined.
- [ ] **Step 3: Implement** `export_row(sighting) -> list[str]`: species, count or `"present"`, date as `%d/%m/%Y`, site, grid reference, notes or `""`.
- [ ] **Step 4: Run to see them pass.** Expected: 2 passed.
- [ ] **Step 5: Commit** `feat(export): write a sighting as a recorder row`.

### Task 2: A year's file

**Files:**
- Modify: `birdlog/export.py`
- Test: `tests/test_export.py`

- [ ] **Step 1: Write the failing test** — `write_year(sightings, 2026, out)` writes the header row `Species,Count,Date,Site,Grid ref,Notes` and then only the 2026 sightings, oldest first; a sighting from 31/12/2025 is left out.
- [ ] **Step 2: Run to see it fail** — `uv run pytest tests/test_export.py -k year`. Expected: FAIL.
- [ ] **Step 3: Implement** `write_year` with `csv.writer` over the rows from Task 1, sorted by `seen_on`.
- [ ] **Step 4: Run to see it pass**, then commit `feat(export): write one year of sightings`.

### Task 3: Command, import, settings and help

**Files:**
- Modify: `birdlog/cli.py`, `birdlog/importer.py`, `birdlog/settings.py`, `README.md`
- Test: `tests/test_cli.py`, `tests/test_importer.py`

- [ ] **Step 1: Write the failing tests** — `birdlog export 2026 -o out.csv` writes the file from Task 2; `birdlog import eBird.csv` reads an eBird download into the log; `birdlog settings --county Cornwall` stores the county.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the `export` subcommand, an eBird importer, a settings file for the county and grid-reference precision, and a README section for each.
- [ ] **Step 4: Run to see them pass**, then commit.

### Task 4: Only sightings since a date

Add a `--since DD/MM/YYYY` option to `birdlog export` so a recorder who already has the
spring records can ask for the rest of the year. Sightings on the given date are included.

### Task 5: Sensitive species

**Files:**
- Modify: `birdlog/export.py`
- Test: `tests/test_export.py`

- [ ] **Step 1: Write the failing test** — a sighting of a species on the county's sensitive list (Schedule 1 breeders such as Peregrine) is exported with its grid reference cut to its 10 km square (`SW53` for `SW5537`), and every other species keeps its full reference.
- [ ] **Step 2: Run to see it fail** — `uv run pytest tests/test_export.py -k sensitive`. Expected: FAIL.
- [ ] **Step 3: Implement** a `SENSITIVE` set in `export.py` and trim the grid reference in `export_row` when the species is in it.
- [ ] **Step 4: Run to see it pass**, then commit `feat(export): blur grid references of sensitive species`.
