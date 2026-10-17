import json
import os
import re
import sys

print("🚀 Running Knowledge Observatory Refinement Assertion Suite...\n")

# 1. Check index.html
print("--- 1. Checking index.html ---")
with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Check SVG symbols
assert 'id="i-observatory"' in html, "index.html missing symbol #i-observatory"
assert 'id="i-graft"' in html, "index.html missing symbol #i-graft"
assert 'id="i-cultivate"' in html, "index.html missing symbol #i-cultivate"
assert 'id="i-close"' in html, "index.html missing symbol #i-close"
assert 'id="i-book"' in html, "index.html missing symbol #i-book"
assert 'id="i-open"' in html, "index.html missing symbol #i-open"

# Check telescope SVG path
assert "M10 12l8-8" in html, "i-observatory must be telescope path"

# Check that observatory dialog template in index.html does NOT contain emoji 🔄
assert "🔄" not in html, "index.html must not contain raw emoji 🔄 in observatory header"
assert 'id="observatory-sheet"' in html, "index.html must contain #observatory-sheet"
print("✓ index.html symbols and symmetrical header template verified.")

# 2. Check src/style.css
print("\n--- 2. Checking src/style.css ---")
with open("src/style.css", "r", encoding="utf-8") as f:
    css = f.read()

# Scrollbar suppression
assert ".observatory-tabs," in css or "#observatory-sheet .seg" in css, "style.css missing tab container selector"
assert "scrollbar-width: none" in css, "style.css missing scrollbar-width: none"
assert "-ms-overflow-style: none" in css, "style.css missing -ms-overflow-style: none"
assert "::-webkit-scrollbar" in css and "display: none !important" in css, "style.css missing webkit scrollbar suppression"

# Bottom clearance & grid
assert "#observatory-sheet .sheet-inner" in css and "calc(36px + env(safe-area-inset-bottom" in css, "missing bottom clearance in #observatory-sheet .sheet-inner"
assert ".observatory-grid" in css, "missing .observatory-grid in style.css"
assert ".observatory-body" in css and "calc(36px + env(safe-area-inset-bottom" in css, "missing bottom clearance in .observatory-body"

# Format badge & clickable rows
assert ".format-badge" in css, "missing .format-badge in style.css"
assert ".row-main.clickable" in css, "missing .row-main.clickable in style.css"
assert ".book-card-main.clickable" in css, "missing .book-card-main.clickable in style.css"
print("✓ src/style.css tab scrollbar suppression, bottom clearance, and interactive styles verified.")

# 3. Check src/ui/notes.js & src/ui/shelf.js
print("\n--- 3. Checking notes.js & shelf.js triggers ---")
with open("src/ui/notes.js", "r", encoding="utf-8") as f:
    notes_js = f.read()
assert "notes-observatory-btn" in notes_js, "notes.js missing notes-observatory-btn"
assert "icon('observatory'" in notes_js, "notes.js must use icon('observatory')"
assert "el('span', {}, 'Observatory')" in notes_js, "notes.js must wrap Observatory label in span"

with open("src/ui/shelf.js", "r", encoding="utf-8") as f:
    shelf_js = f.read()
assert "shelf-observatory-btn" in shelf_js, "shelf.js missing shelf-observatory-btn"
assert "icon('observatory'" in shelf_js, "shelf.js must use icon('observatory')"
assert "el('span', {}, 'Observatory')" in shelf_js, "shelf.js must wrap Observatory label in span"
print("✓ notes.js and shelf.js trigger buttons cleanly use SVG #i-observatory.")

# 4. Check src/ui/observatory.js
print("\n--- 4. Checking src/ui/observatory.js implementation ---")
with open("src/ui/observatory.js", "r", encoding="utf-8") as f:
    obs_js = f.read()

# Zero emoji / raw unicode tofu
for emoji in ["🔄", "🔭", "📖", "📝", "⚡", "🌉", "🌿"]:
    assert emoji not in obs_js, f"observatory.js must not contain raw emoji {emoji}"

# Symmetrical header with icon('observatory', 'i i-sm')
assert "icon('observatory', 'i i-sm')" in obs_js, "observatory.js must include observatory icon in header"
assert "sheet-head-titles" in obs_js, "observatory.js must use sheet-head-titles layout"

# Tabs use SVG icons
assert "icon(t.iconName, 'i i-sm')" in obs_js, "observatory tabs must use icon(t.iconName, 'i i-sm')"

# 1-tap Graft button on orphans
assert "title: `Graft “${o.title}” to another note`" in obs_js, "missing 1-tap Graft button on orphans"
assert "pickNote(`Graft “${o.title}” to…`" in obs_js, "Graft button must call pickNote"
assert "addToSection(text, 'Related'" in obs_js, "Graft must add reciprocal wikilink"

# Conceptual bridges row navigation
assert "row-main clickable" in obs_js, "bridge and orphan rows must have clickable class"
assert "icon('graft', 'i i-sm bridge-glyph')" in obs_js, "bridges must use graft icon"

# Literature Harvest book cards with format badge and open action
assert "formatBadge" in obs_js, "harvest book cards must render formatBadge"
assert "openBookAction" in obs_js, "harvest book cards must define openBookAction"
assert "openBook" in obs_js, "must open document via openBook / openBookRef"
print("✓ src/ui/observatory.js triage actions, SVG glyphs, and interactive flows verified.")

# 5. Check src/observatory.js metrics
print("\n--- 5. Checking src/observatory.js metrics computation ---")
with open("src/observatory.js", "r", encoding="utf-8") as f:
    obs_calc = f.read()
assert "format" in obs_calc, "booksHarvest items must include format property"
assert "sourcesCount" in obs_calc, "computeObservatoryMetrics must include sourcesCount"
print("✓ src/observatory.js data structures and format resolution verified.")

print("\n🎉 ALL KNOWLEDGE OBSERVATORY REFINEMENT ASSERTIONS PASSED WITH 100% SUCCESS!")

