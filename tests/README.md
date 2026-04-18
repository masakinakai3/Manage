<!--
  Copyright (c) 2026 Masaki Nakai (https://github.com/masakinakai3)
  Released under the MIT license
  https://opensource.org/licenses/mit-license.php
-->
# Backend Test Guide

## Prerequisites

- Python 3.10 or later
- Backend dependencies installed with `pip install -r backend/requirements.txt`
- `pytest` installed with `pip install pytest`

## Running Tests

Run all backend tests from the repository root:

```bash
python -m pytest
```

Use verbose output when you want the full case-by-case result:

```bash
python -m pytest -v
```

## Test Files

- `conftest.py`: shared fixtures, app setup, and test database configuration
- `test_models.py`: model-level behavior for `User`, `Member`, `Theme`, and `Allocation`
- `test_api.py`: API endpoint behavior including authentication and CRUD flows
- `test_priority.py`: priority-related behavior and regression coverage
