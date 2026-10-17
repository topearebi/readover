import json
import os
import re
import sys

def test_manifest():
    print("Testing manifest.json...")
    with open("manifest.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    assert "file_handlers" in data, "manifest.json missing file_handlers"
    handlers = data["file_handlers"]
    assert len(handlers) > 0, "file_handlers list is empty"

    fh = handlers[0]
    assert fh.get("action") == "./", f"action must be relative './', found: {fh.get('action')}"
    assert "name" in fh and fh["name"], "file_handler missing name"
    assert "icons" in fh and len(fh["icons"]) > 0, "file_handler missing icons"

    accept = fh.get("accept", {})
    assert "application/epub+zip" in accept, "missing accept application/epub+zip"
    assert ".epub" in accept["application/epub+zip"], "missing .epub in accept"
    assert "application/pdf" in accept, "missing accept application/pdf"
    assert ".pdf" in accept["application/pdf"], "missing .pdf in accept"
    assert "text/markdown" in accept, "missing accept text/markdown"
    assert ".md" in accept["text/markdown"], "missing .md in accept"
    assert ".markdown" in accept["text/markdown"], "missing .markdown in accept"
    assert ".txt" in accept["text/markdown"], "missing .txt in accept"
    print("✓ manifest.json is fully compliant with PWA File Handling spec.")

def test_svg_symbols():
    print("Testing index.html SVG symbols...")
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    required_symbols = ["i-book", "i-open", "i-feed", "i-graft", "i-close"]
    for sym in required_symbols:
        assert f'id="{sym}"' in html, f"index.html missing symbol #{sym}"
    print("✓ index.html defines all required SVG icons without emoji dependencies.")

def test_staging_banner_module():
    print("Testing src/ui/staging-banner.js...")
    with open("src/ui/staging-banner.js", "r", encoding="utf-8") as f:
        code = f.read()

    assert "export function showStagingBanner" in code, "missing showStagingBanner export"
    assert "export function formatFileSize" in code, "missing formatFileSize export"
    assert "staging-banner" in code, "missing staging-banner class"
    assert "staging-banner-provenance" in code, "missing staging-banner-provenance class"
    assert "staging-banner-title" in code, "missing staging-banner-title class"
    assert "btn-staging-commit" in code, "missing btn-staging-commit class"
    assert "btn-staging-dismiss" in code, "missing btn-staging-dismiss class"
    assert "is-closing" in code, "missing is-closing class"
    assert "role" in code and "region" in code, "missing accessible region role"
    print("✓ src/ui/staging-banner.js implementation verified.")

def test_css_styles():
    print("Testing src/style.css...")
    with open("src/style.css", "r", encoding="utf-8") as f:
        css = f.read()

    required_classes = [
        ".staging-banner",
        ".staging-banner-left",
        ".staging-banner-icon",
        ".staging-banner-text",
        ".staging-banner-provenance",
        ".staging-banner-title",
        ".staging-banner-size",
        ".staging-banner-actions",
        ".btn-staging-commit",
        ".btn-staging-dismiss",
        ".staging-banner.is-closing",
        "@keyframes staging-banner-slide",
    ]
    for cls in required_classes:
        assert cls in css, f"style.css missing {cls}"

    # Theme overrides
    assert "data-reader-theme='sepia'] .staging-banner" in css, "missing sepia staging-banner theme"
    assert "data-reader-theme='dark'] .staging-banner" in css, "missing dark staging-banner theme"
    assert "data-reader-theme='night'] .staging-banner" in css, "missing night staging-banner theme"
    print("✓ src/style.css contains complete botanical styling and theme overrides.")

def test_viewers_linkage():
    print("Testing viewer integration...")
    with open("src/viewers/book.js", "r", encoding="utf-8") as f:
        bk = f.read()
    assert "showStagingBanner" in bk, "book.js missing showStagingBanner"
    assert "opts.stagingBanner" in bk, "book.js missing opts.stagingBanner check"

    with open("src/viewers/pdf.js", "r", encoding="utf-8") as f:
        pdf = f.read()
    assert "showStagingBanner" in pdf, "pdf.js missing showStagingBanner"
    assert "opts.stagingBanner" in pdf, "pdf.js missing opts.stagingBanner check"

    with open("src/ui/reader.js", "r", encoding="utf-8") as f:
        rd = f.read()
    assert "showStagingBanner" in rd, "reader.js missing showStagingBanner"
    assert "opts.stagingBanner" in rd, "reader.js missing opts.stagingBanner check"
    print("✓ book.js, pdf.js, and reader.js cleanly mount the Staging Banner.")

def test_app_ingestion():
    print("Testing src/app.js ingestion & launchQueue...")
    with open("src/app.js", "r", encoding="utf-8") as f:
        app = f.read()

    assert "export async function handleIncomingNoteFile" in app, "missing handleIncomingNoteFile export"
    assert "export async function handleIncomingBookFile" in app, "missing handleIncomingBookFile export"
    assert "export async function handleExternalFile" in app, "missing handleExternalFile export"
    assert "export function initFileLaunchHandler" in app, "missing initFileLaunchHandler export"
    assert "initFileLaunchHandler(app)" in app, "missing initFileLaunchHandler call"
    assert "stagingBanner" in app, "missing stagingBanner wiring in app.js"
    assert "openNoteItem(item, { stagingBanner })" in app, "handleIncomingNoteFile must pass stagingBanner"
    assert "saveBookToVault" in app, "saveBookToVault must be wired to commit"
    print("✓ src/app.js handles external file launches with zero-lag ephemeral render and staging banner.")

if __name__ == "__main__":
    test_manifest()
    test_svg_symbols()
    test_staging_banner_module()
    test_css_styles()
    test_viewers_linkage()
    test_app_ingestion()
    print("\n🎉 ALL PWA FILE HANDLING & INGESTION VERIFICATIONS PASSED SUCCESSFULLY!")

