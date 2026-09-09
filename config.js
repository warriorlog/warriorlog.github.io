/* The only file that changes between deployments. */
window.WARRIORLOG_CONFIG = {
  basePath: '/',                     // '/warriorlog/' if ever served from a sub-path
  owner: 'warriorlog',
  repo: 'warriorlog.github.io',
  dataBranch: 'data',                // an orphan branch: log commits never rebuild the site
  api: 'https://api.github.com',
};
