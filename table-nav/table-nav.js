var start;
window.onload = function() {
  start = document.getElementById('start');
  start.focus();
  var out = document.getElementById("out");
  out.value = "test";
}

function navigate(cell) {
  console.log(cell)
  if (cell != null) {
    cell.focus();
    start = cell;
    // out.value = cell.innerHTML;
    out.value = document.activeElement.innerHTML;
  }
}
  document.onkeydown = checkKey;

function checkKey(e) {
  e = e || window.event;
  if (e.keyCode == '9') { // tab
    if (document.activeElement.tagName == "BODY") {
      document.getElementById("start").focus()
    }
  } else if (e.keyCode == '38') { // down arrow
    var idx = start.cellIndex;
    var nextrow = start.parentElement.previousElementSibling;
    if (nextrow != null) {
      var cell = nextrow.cells[idx];
      navigate(cell);
    }
  } else if (e.keyCode == '40') { // down arrow
    var idx = start.cellIndex;
    var nextrow = start.parentElement.nextElementSibling;
    if (nextrow != null) {
      var cell = nextrow.cells[idx];
      navigate(cell);
    }
  } else if (e.keyCode == '37') { // left arrow
    var cell = start.previousElementSibling;
    navigate(cell);
  } else if (e.keyCode == '39') { // right arrow
    var cell = start.nextElementSibling;
    navigate(cell);
  }
}
