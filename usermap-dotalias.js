exports.getUser = function(userPart) {
    if(userPart.indexOf('.')) {
        return userPart.split('.')[1];
    }
    return userPart;
};
