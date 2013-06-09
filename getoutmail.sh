#!/bin/sh

UHOME=$(awk -F ':' -v v="$1" '{if ($1 == v) print $6}' /etc/passwd)
FILE=$(ls -1t $UHOME/Maildir/out/ | tail -1)
FNAME=$(basename $FILE)

ls -1 $UHOME/Maildir/out | awk -v home="$UHOME" '{ print home"/Maildir/out/"$1";"home"/Maildir/dat/"$1".out.hdr" }'
