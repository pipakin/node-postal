#!/bin/sh

UHOME=$(awk -F ':' -v v="$1" '{if ($1 == v) print $6}' /etc/passwd)
UUID=$(basename $2)
DATE=$(date)

mv $2 $UHOME/Maildir/$4/$UUID
mv $2.hdr $UHOME/Maildir/dat/$UUID.$4.hdr
