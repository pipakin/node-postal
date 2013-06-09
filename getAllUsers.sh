#!/bin/sh

## get mini UID limit ##
UID_MIN_L=$(grep "^UID_MIN" /etc/login.defs)
 
## get max UID limit ##
UID_MAX_L=$(grep "^UID_MAX" /etc/login.defs)
  
## use awk to print if UID >= $MIN and UID <= $MAX   ##
awk -F':' -v "min=${UID_MIN_L##UID_MIN}" -v "max=${UID_MAX_L##UID_MAX}" '{ if ( $3 >= min && $3 <= max ) print $1}' /etc/passwd
