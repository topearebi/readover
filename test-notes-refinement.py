#!/usr/bin/env python3
"""
Test Suite: Notes Screen Layout, Interaction Hierarchy & Empty-State Refinement
Verifies structural layout, icon wiring, empty-state copy, and CSS rules.
"""

import sys
import re
from pathlib import Path

def test_index_html():
    print("--- 1. Checking index.html ---")
    html = Path("index.html").read_text(encoding="utf-8")
    
    assert '<symbol id="i-observatory"' in html, "Missing #i-observatory symbol in index.html"
    assert '<symbol id="i-seed"' in html, "Missing #i-seed symbol in index.html"
    
    # Check for unicode tofu or misplaced raw emojis
    assert "⯑" not in html, "Found broken unicode tofu ⯑ in index.html"
    
    print("✓ index.html symbols and clean markup verified.")

def test_notes_js():
    print("\n--- 2. Checking src/ui/notes.js ---")
    js = Path("src/ui/notes.js").read_text(encoding="utf-8")
    
    # Check observatory button attributes
    assert "observatory-trigger-btn" in js, "observatory-trigger-btn class missing in notes.js"
    assert "notes-observatory-btn" in js, "notes-observatory-btn class missing in notes.js"
    assert "icon('observatory', 'i i-sm')" in js, "Observatory icon must use SVG #i-observatory"
    assert "Open Knowledge Observatory" in js, "Observatory button title/aria-label missing"
    
    # Check subheader actions: strictly NO "New note here" button
    assert "New note here" not in js, "Redundant 'New note here' button found in notes.js"
    assert "newBtn" not in js, "newBtn should not exist in notes.js subheader"
    
    # Subheader actions container must only have observatoryBtn and manageBtn
    assert re.search(r"el\('div',\s*\{\s*class:\s*'notes-bar-actions'\s*\},\s*observatoryBtn,\s*manageBtn\)", js), \
        "notes-bar-actions must contain only observatoryBtn and manageBtn"
        
    # Check 2-sided layout with notes-heading
    assert "notes-heading" in js, "notes-heading class missing from crumbs rendering"
    assert "All notes " in js and "notes-count" in js, "Dynamic counter markup missing in notes heading"
    
    # Check controls row class
    assert "notes-controls-row" in js, "notes-controls-row class missing from tools row"
    
    # Check empty state function and modernized copy
    assert "renderEmptyNotesState" in js, "renderEmptyNotesState function missing"
    assert "Your garden is ready to grow" in js, "Empty state heading missing"
    assert "Dropbox, GitHub, WebDAV" in js, "Empty state must acknowledge multi-provider storage"
    assert "Write a note" in js, "1-tap 'Write a note' quick action missing"
    assert "Connect storage" in js, "1-tap 'Connect storage' quick action missing"
    assert "icon('seed', 'i i-lg')" in js, "Empty state must use i-seed with i-lg class"
    
    # Check tofu
    assert "⯑" not in js, "Found broken unicode tofu ⯑ in notes.js"
    
    print("✓ src/ui/notes.js interaction hierarchy and empty-state verified.")

def test_style_css():
    print("\n--- 3. Checking src/style.css ---")
    css = Path("src/style.css").read_text(encoding="utf-8")
    
    assert ".i-lg" in css, ".i-lg class missing in style.css"
    assert ".notes-controls-row" in css, ".notes-controls-row styling missing"
    assert ".observatory-trigger-btn" in css, ".observatory-trigger-btn styling missing"
    assert ".notes-heading" in css, ".notes-heading styling missing"
    assert ".notes-empty-state" in css, ".notes-empty-state styling missing"
    assert ".empty-icon-wrap" in css, ".empty-icon-wrap styling missing"
    assert ".empty-actions" in css, ".empty-actions styling missing"
    
    # Touch target bounds check
    assert "min-height: 44px" in css or "min-height: 38px" in css, "Touch target bounds missing"
    
    print("✓ src/style.css notes layout, touch targets, and typography verified.")

def test_ast_and_syntax():
    print("\n--- 4. Checking JS syntax via Acorn AST parser ---")
    import subprocess
    cmd = [
        "/usr/share/code/code",
        "-e",
        """
import fs from 'node:fs';
import * as acorn from 'acorn';
for (const p of ['src/ui/notes.js', 'src/app.js', 'src/ui/observatory.js', 'src/observatory.js']) {
    const code = fs.readFileSync(p, 'utf8');
    acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest', locations: true });
    console.log(`✓ ${p} parsed cleanly with zero syntax errors.`);
}
"""
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        raise AssertionError(f"Acorn AST parse failed: {res.stderr}")
    print(res.stdout.strip())

def main():
    print("🚀 Running Notes Screen Layout & Empty-State Refinement Test Suite...\n")
    try:
        test_index_html()
        test_notes_js()
        test_style_css()
        test_ast_and_syntax()
        print("\n🎉 ALL NOTES SCREEN REFINEMENT ASSERTIONS PASSED WITH 100% SUCCESS!")
    except AssertionError as e:
        print(f"\n❌ Assertion Failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
