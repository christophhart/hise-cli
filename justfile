set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
	@just --list

install:
	npm install

build:
	npm run build

bun:
	npm run build:binary:{{ if os() == "macos" { "mac" } else if os() == "windows" { "windows" } else { "linux" } }}

bun-mac:
	npm run build:binary:mac

bun-mac-x64:
	npm run build && node scripts/build-binary.mjs --target bun-darwin-x64

# Sync src/engine/highlight/ → highlight-export/ for docs website consumption
export-highlight:
	npm run export-highlight

# Build the docs-site embed bundle and copy into the HISE website's public/embed/
embed website_root="/Users/christophhart/Development/hise_website_v2":
	npm run build:embed
	rm -rf "{{ website_root }}/public/embed"
	mkdir -p "{{ website_root }}/public/embed"
	cp -R dist/embed/. "{{ website_root }}/public/embed/"
	@echo "[embed] copied → {{ website_root }}/public/embed"
