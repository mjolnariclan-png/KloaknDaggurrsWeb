'use strict';

/**
 * Minimal in-memory MongoDB substitute for the automated test suite.
 * Emulates the exact subset of the mongo driver API used by
 * server-production.js, including unique-index behavior (code 11000)
 * which the "exactly once" reward logic depends on.
 */

const UNIQUE_KEYS = {
  player_progression: [['user_id']],
  match_rewards: [['match_id']],
  currency_transactions: [['user_id', 'match_id', 'reason']],
  game_matches: [['game_id']],
  ai_matches: [['ai_match_id']],
  prebuilt_decks: [['deck_name']],
};

function matchEq(docValue, filterValue) {
  if (filterValue === null) return docValue === null || docValue === undefined;
  if (filterValue && typeof filterValue === 'object' && !Array.isArray(filterValue)) {
    // Operator object: { $ne, $gte, $lte, $lt, $gt, $in }
    for (const [op, val] of Object.entries(filterValue)) {
      switch (op) {
        case '$ne': return docValue !== val;
        case '$gte': return docValue >= val;
        case '$lte': return docValue <= val;
        case '$gt': return docValue > val;
        case '$lt': return docValue < val;
        case '$in': return Array.isArray(val) && val.includes(docValue);
        case '$exists': return val ? docValue !== undefined : docValue === undefined;
        default: throw new Error(`fake-mongo: unsupported operator ${op}`);
      }
    }
    return true;
  }
  if (filterValue instanceof Date) return new Date(docValue).getTime() === filterValue.getTime();
  return docValue === filterValue;
}

function matchesFilter(doc, filter) {
  for (const [key, value] of Object.entries(filter || {})) {
    if (key === '$or') {
      if (!value.some((f) => matchesFilter(doc, f))) return false;
      continue;
    }
    if (key === '$and') {
      if (!value.every((f) => matchesFilter(doc, f))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`fake-mongo: unsupported filter op ${key}`);
    if (!matchEq(doc[key], value)) return false;
  }
  return true;
}

function applyUpdate(doc, update) {
  for (const [op, fields] of Object.entries(update || {})) {
    if (op === '$set') Object.assign(doc, fields);
    else if (op === '$inc') {
      for (const [k, v] of Object.entries(fields)) doc[k] = (doc[k] || 0) + v;
    } else if (op === '$unset') {
      for (const k of Object.keys(fields)) delete doc[k];
    } else if (op === '$push') {
      for (const [k, v] of Object.entries(fields)) (doc[k] = doc[k] || []).push(v);
    } else if (op === '$setOnInsert') {
      // no-op here: applied only on insert path
    } else {
      throw new Error(`fake-mongo: unsupported update op ${op}`);
    }
  }
}

class FakeCollection {
  constructor(name, store) {
    this.name = name;
    this.store = store; // Map<_id, doc>
    this._idSeq = 0;
  }

  _docs() { return [...this.store.values()]; }

  async createIndex() { return this.name; }

  async insertOne(doc) {
    const keys = (UNIQUE_KEYS[this.name] || []);
    for (const key of keys) {
      const dup = this._docs().some((d) => key.every((k) => d[k] === doc[k]));
      if (dup) {
        const err = new Error(`E11000 duplicate key on ${this.name}`);
        err.code = 11000;
        throw err;
      }
    }
    const _id = doc._id !== undefined ? doc._id : `fake_${this.name}_${this._idSeq++}`;
    this.store.set(_id, { ...doc, _id });
    return { acknowledged: true, insertedId: _id };
  }

  async findOne(filter) {
    // Real MongoDB returns deserialized copies; never expose live references.
    const found = this._docs().find((d) => matchesFilter(d, filter));
    return found ? { ...found } : null;
  }

  find(filter) {
    const docs = this._docs().filter((d) => matchesFilter(d, filter));
    return {
      sort(spec) {
        if (!spec) return this;
        const entries = Object.entries(spec);
        docs.sort((a, b) => {
          for (const [k, dir] of entries) {
            if (a[k] < b[k]) return -1 * dir;
            if (a[k] > b[k]) return 1 * dir;
          }
          return 0;
        });
        return this;
      },
      async toArray() { return docs.map((d) => ({ ...d })); },
    };
  }

  async countDocuments(filter) {
    return this._docs().filter((d) => matchesFilter(d, filter)).length;
  }

  async updateOne(filter, update, options = {}) {
    const doc = this._docs().find((d) => matchesFilter(d, filter));
    if (!doc) {
      if (options.upsert) {
        const seed = {};
        for (const [k, v] of Object.entries(filter || {})) {
          if (!k.startsWith('$') && !(v && typeof v === 'object')) seed[k] = v;
        }
        const setOnInsert = update && update.$setOnInsert ? update.$setOnInsert : {};
        Object.assign(seed, setOnInsert);
        applyUpdate(seed, update);
        await this.insertOne(seed);
        return { acknowledged: true, modifiedCount: 0, upsertedCount: 1 };
      }
      return { acknowledged: true, modifiedCount: 0, upsertedCount: 0 };
    }
    applyUpdate(doc, update);
    return { acknowledged: true, modifiedCount: 1, upsertedCount: 0 };
  }

  async updateMany(filter, update) {
    let n = 0;
    for (const doc of this._docs()) {
      if (matchesFilter(doc, filter)) { applyUpdate(doc, update); n++; }
    }
    return { acknowledged: true, modifiedCount: n };
  }

  async deleteOne(filter) {
    const doc = this._docs().find((d) => matchesFilter(d, filter));
    if (doc) { this.store.delete(doc._id); return { acknowledged: true, deletedCount: 1 }; }
    return { acknowledged: true, deletedCount: 0 };
  }

  async deleteMany(filter) {
    let n = 0;
    for (const doc of this._docs()) {
      if (matchesFilter(doc, filter)) { this.store.delete(doc._id); n++; }
    }
    return { acknowledged: true, deletedCount: n };
  }
}

function createFakeDb() {
  const collections = new Map();
  return {
    collection(name) {
      if (!collections.has(name)) collections.set(name, new FakeCollection(name, new Map()));
      return collections.get(name);
    },
    __collections: collections,
  };
}

module.exports = { createFakeDb };
