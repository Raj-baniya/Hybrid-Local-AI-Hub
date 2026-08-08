#!/bin/bash
echo 'Running EnglishToHindiTranslatorAgent...'
python3 "$(dirname "$0")/agent.py" "$@"
