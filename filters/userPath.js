module.exports = function(req, path, cb) {
    if(req.to === undefined) { 
        cb(null, 0, '');
        return;
    }

    if(req.user || req.config.domains.indexOf(req.remoteAddr) > -1) {
        req.logger.info('valid user');
        cb(null, 0, '');
        return;
    }

    var theUser = req.usermap.getUser(req.to.split('@')[0]);

    if(req.config.domains.indexOf(req.to.split('@')[1]) > -1 && theUser) {
        req.platform.checkUser(theUser, function(err, valid) {
            if(valid) {
                req.logger.info('to local user');
                cb(null, 0, '');
            }
            else {
                req.logger.info('invalid local user');
                cb(null, 101, 'invalid local user');
            }
        });
    }
    else {
        req.logger.info('spoof attempt from ' + req.remoteAddr + ' to ' + to);
        cb(null, 101, 'spoof attempt');
    }
}
