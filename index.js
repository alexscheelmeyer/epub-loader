const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { parseStringPromise } = require('xml2js');


async function loadZip(filename) {
  return await unzipper.Open.file(filename);
}

async function getEpubFileContents(directory, filename) {
  const file = directory.files.find(d => d.path === filename);
  return await file.buffer();
}

async function loadEpub(filename) {
  const directory = await loadZip(filename)
    .catch((e) => {
      throw new Error(`Could not load ${filename} (${e.message})`);
    });

  const files = directory.files ? directory.files.map((f) => f.path) : [];
  if (files.length === 0) throw new Error('No files found in in epub');

  // make a check of the mimetype
  if (files.indexOf('mimetype') < 0) throw new Error('Mimetype not found');
  const mimetype = (await getEpubFileContents(directory, 'mimetype')).toString('utf-8');
  if (mimetype !== 'application/epub+zip') throw new Error(`Unexpected mimetype (${mimetype})`);

  // load the container file
  // TODO: find out if the casing of the filename can be different
  if (files.indexOf('META-INF/container.xml') < 0) throw new Error('Container file not found');
  const containerStr = (await getEpubFileContents(directory, 'META-INF/container.xml')).toString('utf-8');
  const container = await parseStringPromise(containerStr);
  let rootfile = _.get(container, ['container', 'rootfiles', 0, 'rootfile']);
  if (!rootfile) throw new Error('Rootfile not found');
  if (!Array.isArray(rootfile)) rootfile = [rootfile];

  // grab the root file
  let rootFilename;
  for (const rf of rootfile) {
    const mediaType = _.get(rf, ['$', 'media-type']);
    const fullPath = _.get(rf, ['$', 'full-path']);
    if (mediaType === 'application/oebps-package+xml' && fullPath) {
      rootFilename = fullPath;
      break;
    }
  }
  if (!rootFilename) throw new Error('Could not get full path of root file');

  // load the root xml
  if (files.indexOf(rootFilename) < 0) throw new Error('Root file not found');
  const rootStr = (await getEpubFileContents(directory, rootFilename)).toString('utf-8');
  const root = await parseStringPromise(rootStr);
  const rootPath = path.dirname(rootFilename);

  const metadata = _.get(root, 'package.metadata');

  const manifestData = _.get(root, ['package', 'manifest', 0, 'item'], []);
  const manifest = manifestData.map((m) => _.get(m, '$'));

  const spineData = _.get(root, ['package', 'spine', 0, 'itemref'], []);
  const spine = spineData.map((s) => _.get(s, '$.idref'));

  return { files, manifest, metadata, spine,
    getFileContent: async function(filename) {
      return getEpubFileContents(directory, filename);
    },
    getFileContentById: async function(id) {
      const href = _.get(manifest.find((m) => m.id === id), 'href');
      const filepath = path.normalize(`${rootPath}/${href}`);
      if (files.indexOf(filepath) < 0) throw new Error(`Id ${id} not found`);
      return getEpubFileContents(directory, filepath);
    },
  };
}

module.exports = {
  loadEpub
}
