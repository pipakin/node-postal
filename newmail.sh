#!/bin/sh

UHOME=$(awk -F ':' -v v="$1" '{if ($1 == v) print $6}' /etc/passwd)

if [ ! -d $UHOME/Maildir ]; then
    mkdir $UHOME/Maildir
    chown $1 $UHOME/Maildir
    chgrp $1 $UHOME/Maildir
fi

if [ ! -d $UHOME/Maildir/tmp ]; then
    mkdir $UHOME/Maildir/tmp
    chown $1 $UHOME/Maildir/tmp
    chgrp $1 $UHOME/Maildir/tmp
fi

if [ ! -d $UHOME/Maildir/new ]; then
    mkdir $UHOME/Maildir/new
    chown $1 $UHOME/Maildir/new
    chgrp $1 $UHOME/Maildir/new
fi

if [ ! -d $UHOME/Maildir/cur ]; then
    mkdir $UHOME/Maildir/cur
    chown $1 $UHOME/Maildir/cur
    chgrp $1 $UHOME/Maildir/cur
fi

if [ ! -d $UHOME/Maildir/out ]; then
    mkdir $UHOME/Maildir/out
    chown $1 $UHOME/Maildir/out
    chgrp $1 $UHOME/Maildir/out
fi

if [ ! -d $UHOME/Maildir/dat ]; then
    mkdir $UHOME/Maildir/dat
    chown $1 $UHOME/Maildir/dat
    chgrp $1 $UHOME/Maildir/dat
fi

UUID=$(uuidgen | awk -F '-' '{print $1$2$3$4$5}')
touch $UHOME/Maildir/tmp/$UUID
chown $1 $UHOME/Maildir/tmp/$UUID
chgrp $1 $UHOME/Maildir/tmp/$UUID
touch $UHOME/Maildir/tmp/$UUID.hdr
chown $1 $UHOME/Maildir/tmp/$UUID.hdr
chgrp $1 $UHOME/Maildir/tmp/$UUID.hdr
echo "$UHOME/Maildir/tmp/$UUID"
