set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default:
	@just --list

install:
	npm install

build:
	npm run build

bun:
	npm run build:binary:windows
