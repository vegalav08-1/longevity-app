// Link prefix: "" for the owner, "guest/<id>/<key>/" in guest mode.
// Every internal hash link is built here so a guest never loses the prefix.
let prefix = "";

export function setRoutePrefix(p) {
  prefix = p;
}

export function link(path = "") {
  return "#/" + prefix + path;
}
