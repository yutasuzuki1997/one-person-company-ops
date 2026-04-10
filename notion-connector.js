'use strict';

const { Client } = require('@notionhq/client');

function makeClient(token) {
  if (!token || !token.trim()) throw new Error('Notion tokenが未設定です');
  return new Client({ auth: token });
}

async function testConnection(token) {
  try {
    const notion = makeClient(token);
    const me = await notion.users.me({});
    return { success: true, ok: true, user: me.name || me.id };
  } catch (e) {
    return { success: false, ok: false, error: e.message };
  }
}

async function listDatabases(token) {
  try {
    const notion = makeClient(token);
    const resp = await notion.search({ filter: { property: 'object', value: 'database' } });
    const databases = resp.results.map((db) => ({
      id: db.id,
      title: db.title?.map((t) => t.plain_text).join('') || '(無題)',
    }));
    return { success: true, databases };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function queryDatabase(token, databaseId, filter, sorts) {
  try {
    const notion = makeClient(token);
    const params = { database_id: databaseId };
    if (filter) params.filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
    if (sorts) params.sorts = typeof sorts === 'string' ? JSON.parse(sorts) : sorts;
    const resp = await notion.databases.query(params);
    return { success: true, data: resp.results };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function createPage(token, databaseId, properties) {
  try {
    const notion = makeClient(token);
    const props = typeof properties === 'string' ? JSON.parse(properties) : properties;
    const resp = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: props,
    });
    return { success: true, data: { id: resp.id, url: resp.url } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function updatePage(token, pageId, properties) {
  try {
    const notion = makeClient(token);
    const props = typeof properties === 'string' ? JSON.parse(properties) : properties;
    const resp = await notion.pages.update({ page_id: pageId, properties: props });
    return { success: true, data: { id: resp.id, url: resp.url } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function getPage(token, pageId) {
  try {
    const notion = makeClient(token);
    const resp = await notion.pages.retrieve({ page_id: pageId });
    return { success: true, data: resp };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function searchPages(token, query) {
  try {
    const notion = makeClient(token);
    const resp = await notion.search({ query: query || '' });
    return { success: true, data: resp.results };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function appendBlocks(token, pageId, blocks) {
  try {
    const notion = makeClient(token);
    const children = typeof blocks === 'string' ? JSON.parse(blocks) : blocks;
    const resp = await notion.blocks.children.append({
      block_id: pageId,
      children,
    });
    return { success: true, data: resp };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  testConnection,
  listDatabases,
  queryDatabase,
  createPage,
  updatePage,
  getPage,
  searchPages,
  appendBlocks,
};
