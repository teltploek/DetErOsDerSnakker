exports.index = function(req, res){
  res.render('index');
};

exports.error = function(req, res){
  res.render('error');
};

exports.partials = function (req, res) {
  var name = req.params.name;
  res.render('partials/' + name);
};