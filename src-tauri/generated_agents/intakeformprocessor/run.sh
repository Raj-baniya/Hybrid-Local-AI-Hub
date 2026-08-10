#!/bin/bash
echo 'Running IntakeFormProcessor...'
python3 "$(dirname "$0")/agent.py" "$@"
