exports.getUser = function(userPart) {
    if(userPart.indexOf('.') > -1) {
        return userPart.split('.')[1].toLowerCase();
    }
    return userPart.toLowerCase();
};
