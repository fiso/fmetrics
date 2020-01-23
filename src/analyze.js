const fs = require('fs');

const directory = `${__dirname}/../data/snapshots/`;

const files = fs.readdirSync(directory)
    .map(file => `${directory}${file}`)
    .filter(file => !fs.statSync(file).isDirectory())
    .filter(file => file.toLowerCase().endsWith('.json'))
    .sort()
;

let last = null;

for (const file of files) {
  const followers = JSON.parse(fs.readFileSync(file)).sort((a, b) => {
    if (a.id_str < b.id_str) {
      return -1;
    } else if (a.id_str > b.id_str) {
      return 1;
    }

    return 0;
  });

  if (last) {
    const lost = last.filter(
        lastf => !followers.find(f => f.id_str === lastf.id_str));
    const gained = followers.filter(
        f => !last.find(lastf => f.id_str === lastf.id_str));
    const out = `${gained.length > 0 ? '+' + gained.length + ' ' : ''
    }${lost.length > 0 ? '-' + lost.length : ''}`;
    if (out) {
      console.log(out);
    }
  }

  last = followers;
}
