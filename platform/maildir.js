var fs = require('fs');
var path = require('path');
var uuid = require('uuid');
var seq = require('seq');
var pam = require('pam');
var passwd = require('passwd');
var es = require('event-stream');

function spamStream(source) {
    var first = true;
    var last = '';
    var spam = es.map(function (buf, map) {
        var data = buf.toString();
        s = data;
        if(first) {
            var full = last + data;
            if(full.match(/Subject\:/)) {
                s = full.replace(/Subject\:/, 'Subject: [SPAM]').substr(last.length);
                first = false;
            }
            else {
                last = data.substr(Math.max(data.length - 8, 0));
            }
        }
        map(null, s);
    });
    source.writable = true;
    source.readable = true;
    source.pipe(spam);
    return spam;
};

module.exports.createPlatform = function(config, logger) {
    var platform = {};

    //and process /etc/passwdc
    var userTable = {}
    passwd.getAll(function(users) {
        users.forEach(function(user) {
            user.userId = parseInt(user.userId);
            if(user.userId >= 1000 && user.userId <= 60000)
            {
                user.groupId = parseInt(user.groupId);
                userTable[user.username] = user;
            }
        });
    });

    platform.getUsers = function(callback) {
        var users = [];
        for(var user in userTable) {
            users.push(user);
        }
        callback(null, users);
    };

    platform.auth = function(user, pass, callback) {
        pam.auth(user, pass, function(retval) { callback(null, retval); });
    }

    platform.checkUser = function(user, callback) {
        callback(null, !!userTable[user]);
    }

    platform.createEmail = function(user, callback) {
        var id = uuid.v4();
        id = id.replace(/\-/g, '');

        var filePath = path.join(userTable[user].homedir, 'Maildir/tmp/', id);

        var stream = fs.createWriteStream(filePath, {flags: 'a'});
        stream.on('open', function() {
            callback(null, stream, filePath);
        });
    };

    platform.fileEmail = function(id, user, loc, metadata, callback) {
        if(typeof(metadata) == 'function') {
            callback = metadata;
            metadata = undefined;
        }
        
        if(loc == 'inbox') {
            var name = path.basename(id);
            var filePath = path.join(userTable[user].homedir, 'Maildir/new/', name);
            var headerPath = path.join(userTable[user].homedir, 'Maildir/dat/', name);

            seq()
            .seq(function() { fs.chown(id, userTable[user].userId, userTable[user].groupId, this); })
            .seq(function() { fs.link(id, filePath, this); })
            .seq(function() { fs.unlink(id, this); })
            .seq(function() { 
                if(metadata !== undefined) {
                    fs.writeFile(headerPath, JSON.stringify(metadata), this);
                }
                else{
                    this(null);
                }
            })
            .seq(function() { 
                logger.info('file moved: ' + id + ' -> ' + filePath);
                fs.chown(headerPath, userTable[user].userId, userTable[user].groupId, function() {}); 
                this(null);
            })
            .seq(function() { callback(null); })
            .catch(callback);
        }
        else if(loc == 'outbox') {
            var name = path.basename(id);
            var filePath = path.join(userTable[user].homedir, 'Maildir/out/', name);
            var headerPath = path.join(userTable[user].homedir, 'Maildir/dat/', name);

            seq()
            .seq(function() { fs.chown(id, userTable[user].userId, userTable[user].groupId, this); })
            .seq(function() { fs.link(id, filePath, this); })
            .seq(function() { fs.unlink(id, this); })
            .seq(function() { 
                if(metadata !== undefined) {
                    fs.writeFile(headerPath, JSON.stringify(metadata), this);
                }
                else{
                    this(null);
                }
            })
            .seq(function() { 
                logger.info('file moved: ' + id + ' -> ' + filePath);
                fs.chown(headerPath, userTable[user].userId, userTable[user].groupId, function() {}); 
                this(null);
            })
            .seq(function() { callback(null); })
            .catch(callback);
        }
    };

    platform.closeEmail = function(id, user, result, callback) {
        var name = path.basename(id);
        var headerPath = path.join(userTable[user].homedir, 'Maildir/dat/', name);
        
        if(callback === undefined)
            callback = function(){};
             
        if(result == 'delete') {
            seq()
            .seq(function() { fs.unlink(id, this); })
            .seq(function() { fs.exists(headerPath, this); })
            .seq(function(exists) { 
                if(exists) {
                    fs.unlink(headerPath, this);
                }
                else{
                    this(null);
                }
            })
            .seq(callback)
            .catch(callback);
        }
        else {
            callback(null);
        }
    };

    platform.openEmail = function(id, user, callback) {
        var name = path.basename(id);
        var headerPath = path.join(userTable[user].homedir, 'Maildir/dat/', name);

        seq()
        .seq(function(){ fs.exists(headerFile, this); })
        .seq(function(exists){ 
            if(exists) {
                fs.readFile(headerFile, this);
            }
            else{
                this(null);
            }
        })
        .seq(function(jsonString) {
            if(jsonString) {
                this(JSON.parse(jsonString));
            }
            else {
                this({});
            }
        })
        .seq(function(metadata) {
            var stream = fs.createReadStream(id);
            callback(null, stream, metadata);
        });
    };

    platform.listEmails = function(user, loc, callback) {
        if(loc == 'inbox') {
            //move mails from new to cur
            seq()
            .seq(function() { fs.readdir(path.join(userTable[user].homedir, 'Maildir/new'), this); })
            .flatten()
            .parEach(function(file) {
                //move the file
                var curFile = file.replace('Maildir/new', 'Maildir/cur');
                fs.linkSync(file, curFile);
                fs.unlink(file, this);
            })
            .seq(function() { fs.readdir(path.join(userTable[user].homedir, 'Maildir/cur'), callback);  })
        }
        else if(loc == 'outbox') {
            fs.readdir(path.join(userTable[user].homedir, 'Maildir/out'), callback);            
        }
    };

    platform.markAsSpam = function(id, user, callback) {
        var tempFile = id + '.old';
        seq()
        .seq(function() { fs.stat(path, this.into('stats')); })
        .seq(function() { fs.rename(path, tempFile, this); })
        .seq(function() { 
            var stream = fs.createReadStream(tempFile);
            var outstream = fs.createWriteStream(path, { flags: 'w' });
            spamStream(stream).pipe(outstream);
            stream.on('end', this);
        })
        .seq(function() { fs.chown(path, this.vars['stats'].uid, this.vars['stats'].gid, this) })
        .seq(function() { fs.unlink(tempFile, callback); });

    };

    return platform;
}

