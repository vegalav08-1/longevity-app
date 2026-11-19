"""Interface acceptance check.

Serves the parent directory of this repository, opens the app in local mode
(`?base=/longevity-data`) at phone widths, exercises the interactive parts and
saves screenshots. Needs the `playwright` Python package and a Chrome binary.

    python3 tools/acceptance.py <screenshot dir> [chrome path]

The screenshots show real data: keep them out of the repository.
Exit code 0 means no problems were found.
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

APP_DIR = pathlib.Path(__file__).resolve().parent.parent
SERVE_DIR = APP_DIR.parent
DATA_DIR_NAME = "longevity-data"
PORT = 8796
WIDTHS = (390, 320)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    chrome = sys.argv[2] if len(sys.argv) > 2 else "/usr/bin/google-chrome"
    if not (SERVE_DIR / DATA_DIR_NAME).is_dir():
        sys.exit(f"{DATA_DIR_NAME} must be cloned next to {APP_DIR.name}")

    problems = []
    base = f"http://localhost:{PORT}/{APP_DIR.name}/?base=/{DATA_DIR_NAME}"
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=SERVE_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1)

    def shot(page, name, height):
        page.wait_for_timeout(300)
        width = page.viewport_size["width"]
        page.screenshot(path=str(out / name), clip={"x": 0, "y": 0, "width": width, "height": height})
        if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
            problems.append(f"{name}: horizontal overflow")

    def on_console(message):
        text = message.text
        if message.type == "error" and "404" not in text and "Service Worker" not in text:
            problems.append(f"console: {text}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
            for width in WIDTHS:
                context = browser.new_context(
                    viewport={"width": width, "height": 3200}, device_scale_factor=2,
                    service_workers="block", permissions=["clipboard-read", "clipboard-write"],
                )
                page = context.new_page()
                page.on("console", on_console)
                page.on("pageerror", lambda error: problems.append(f"pageerror: {error}"))

                if (SERVE_DIR / DATA_DIR_NAME / "day.json").is_file():
                    page.goto(base + "#/day")
                    page.wait_for_selector(".meter")
                    shot(page, f"day_{width}.png", 2600)
                page.goto(base + "#/plan")
                page.wait_for_selector(".plan-item")
                shot(page, f"plan_{width}.png", 1500)
                page.goto(base + "#/curator")
                page.wait_for_selector(".handoff")
                shot(page, f"curator_{width}.png", 2300)
                page.goto(base + "#/")
                page.wait_for_selector(".domain")
                shot(page, f"today_{width}.png", 2600)
                if width != WIDTHS[0]:
                    context.close()
                    continue

                # Today: the attention filter narrows the list of sections.
                all_domains = page.locator(".domain").count()
                page.get_by_role("button", name="Требуют внимания").click()
                page.wait_for_timeout(200)
                flagged = page.locator(".domain").count()
                if not 0 < flagged <= all_domains:
                    problems.append(f"domain filter: {flagged} of {all_domains}")
                shot(page, "today_filtered.png", 1900)

                # Plan: priority and day filters, disclosure, copy, sent mark.
                page.goto(base + "#/plan")
                page.wait_for_selector(".plan-item")
                total = page.locator(".plan-item").count()
                page.get_by_role("button", name="Высокий").click()
                page.wait_for_timeout(200)
                high = page.locator(".plan-item").count()
                if not 0 < high <= total:
                    problems.append(f"priority filter: {high} of {total}")
                page.get_by_role("button", name="Все").click()
                page.locator(".day:not([disabled])").nth(0).click()
                page.wait_for_timeout(200)
                on_day = page.locator(".plan-item").count()
                if not 0 < on_day <= total:
                    problems.append(f"day filter: {on_day} of {total}")
                page.get_by_role("button", name="Показать все дни").click()

                first = page.locator(".plan-item").nth(0)
                first.locator("summary").click()
                page.wait_for_timeout(200)
                first.get_by_role("button", name="Скопировать").click()
                page.wait_for_timeout(200)
                if not page.evaluate("navigator.clipboard.readText()"):
                    problems.append("copy: clipboard is empty")
                first = page.locator(".plan-item").nth(0)
                first.get_by_role("button", name="Отметить: отправлено куратору").click()
                page.wait_for_timeout(300)
                first = page.locator(".plan-item").nth(0)
                if first.locator(".chip-sent").count() != 1:
                    problems.append("sent mark is not shown")
                if not first.evaluate("el => el.open"):
                    problems.append("plan item closed after marking as sent")
                shot(page, "plan_open.png", 1500)
                context.close()
            browser.close()
    finally:
        server.terminate()

    print("problems:", json.dumps(problems, ensure_ascii=False, indent=1))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
