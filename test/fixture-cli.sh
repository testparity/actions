#!/usr/bin/env sh
case "$*" in
  *--no-check*) exit 0 ;;
  *--format=json*) printf '%s\n' '{"passed":true,"structures":[]}' ;;
  *--format=github*) printf '%s\n' '## TestParity coverage' ;;
  *) exit 1 ;;
esac
