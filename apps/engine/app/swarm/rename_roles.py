import pathlib

files = [
    pathlib.Path("routines.py"),
    pathlib.Path("__init__.py"),
    pathlib.Path("../token_optimizer.py"),
    pathlib.Path("../dispatcher.py"),
]

replacements = [
    ("transfer_to_logic_weaver", "transfer_to_backend_dev"),
    ("transfer_to_pixel_crafter", "transfer_to_frontend_dev"),
    ("transfer_to_guardian", "transfer_to_qa_engineer"),
    ("LogicWeaverRoutine", "BackendDevRoutine"),
    ("PixelCrafterRoutine", "FrontendDevRoutine"),
    ("GuardianRoutine", "QaEngineerRoutine"),
    ('role = "logic_weaver"', 'role = "backend_dev"'),
    ('role = "pixel_crafter"', 'role = "frontend_dev"'),
    ('role = "guardian"', 'role = "qa_engineer"'),
    ('"logic_weaver"', '"backend_dev"'),
    ('"pixel_crafter"', '"frontend_dev"'),
    ('"guardian"', '"qa_engineer"'),
    ("'logic_weaver'", "'backend_dev'"),
    ("'pixel_crafter'", "'frontend_dev'"),
    ("'guardian'", "'qa_engineer'"),
    # dispatcher.py doc comment
    ("→ Guardian", "→ QA Engineer"),
    ("LogicWeaver", "BackendDev"),
    ("PixelCrafter", "FrontendDev"),
    ("Guardian", "QA Engineer"),
    ("Logic Weaver", "Backend Developer"),
    ("Pixel Crafter", "Frontend Developer"),
]

for path in files:
    if not path.exists():
        print(f"SKIP (not found): {path}")
        continue
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new in replacements:
        text = text.replace(old, new)
    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"Updated: {path}")
    else:
        print(f"No changes: {path}")
