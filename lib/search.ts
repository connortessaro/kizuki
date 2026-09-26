import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { contentWords, matchedWords } from "./words";

/** Turns texts into lists of numbers that capture their meaning. `kind` tells the model whether the texts are passages or a search. */
export type Embedder = (texts: string[], kind: "document" | "query") => Promise<number[][]>;

/** A passage as stored in the search file. */
export interface IndexedPassage {
  /** The passage's id: `psg_` and 16 hex characters. */
  passageId: string;
  /** The material the passage comes from. */
  materialId: string;
  /** The course of that material. A search only looks at one course's passages. */
  courseId: string;
  /** The passage's text, searched by keyword and turned into numbers for meaning search. */
  text: string;
}

/** One search result. Higher scores are better matches. */
export interface SearchHit {
  /** The passage that matched. */
  passageId: string;
  /** The keyword and meaning ranks combined: each list the passage is in adds 1 / (61 + its place in that list, counted from 0). */
  score: number;
}

/** The open search file. */
export type SearchIndex = Database.Database;

/**
 * Meaning matches farther than this (cosine distance, 0 is identical) are ignored, so text
 * about something else finds nothing. Measured with nomic-embed-text: related text scored
 * 0.12 to 0.21, unrelated text 0.33 and up.
 */
export const MAX_MEANING_DISTANCE = 0.3;

/** Opens (and creates if needed) the search file at `path`, with keyword and meaning search turned on. */
export function openIndex(path: string): SearchIndex {
  const db = new Database(path);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists meta (key text primary key, value text not null);
    create table if not exists passages (
      rowid integer primary key,
      passage_id text unique not null,
      material_id text not null,
      course_id text not null,
      text text not null
    );
    create index if not exists passages_material on passages(material_id);
    create virtual table if not exists passage_fts using fts5(text, tokenize = 'porter unicode61');
  `);
  upgradeVectors(db);
  return db;
}

/**
 * Moves a search file from an older version, which kept every course's numbers in one table,
 * to one table split by course, so a search only ever looks at its own course. The numbers
 * are copied, so nothing has to be sent to the meaning model again.
 */
function upgradeVectors(db: SearchIndex): void {
  const old = db.prepare("select 1 from sqlite_master where name = 'passage_vec'").get();
  const dim = Number(meta(db, "dim"));
  if (!old || !dim) return;
  db.transaction(() => {
    db.exec(`create virtual table passage_vectors using vec0(course_id text partition key, embedding float[${dim}] distance_metric=cosine)`);
    const rows = db.prepare("select v.rowid as rowid, p.course_id as courseId, v.embedding as embedding from passage_vec v join passages p on p.rowid = v.rowid").all() as {
      rowid: number;
      courseId: string;
      embedding: Buffer;
    }[];
    const insert = db.prepare("insert into passage_vectors (rowid, course_id, embedding) values (?, ?, ?)");
    for (const r of rows) insert.run(BigInt(r.rowid), r.courseId, r.embedding);
    db.exec("drop table passage_vec");
    db.prepare("insert or replace into meta (key, value) values ('layout', 'by-course')").run();
  })();
}

function meta(db: SearchIndex, key: string): string | undefined {
  return (db.prepare("select value from meta where key = ?").get(key) as { value: string } | undefined)?.value;
}

function assertModel(db: SearchIndex, model: string): void {
  const current = meta(db, "embed_model");
  if (current && meta(db, "metric") !== "cosine") throw new Error("the search file is from an older version of Kizuki. Rebuild the search file in Settings.");
  if (current && current !== model) {
    throw new Error(`the search file was built with the meaning model "${current}", not "${model}". Rebuild the search file in Settings.`);
  }
}

function ensureVectorTable(db: SearchIndex, model: string, dim: number): void {
  assertModel(db, model);
  const current = meta(db, "embed_model");
  if (!current) {
    db.prepare("insert into meta (key, value) values ('embed_model', ?), ('dim', ?), ('metric', 'cosine'), ('layout', 'by-course')").run(model, String(dim));
    db.exec(`create virtual table if not exists passage_vectors using vec0(course_id text partition key, embedding float[${dim}] distance_metric=cosine)`);
  } else if (Number(meta(db, "dim")) !== dim) {
    throw new Error(`the meaning model "${model}" now returns ${dim} numbers per passage instead of ${meta(db, "dim")}. Rebuild the search file in Settings.`);
  }
}

/** The meaning model the search file was built with, if any. */
export function indexModel(db: SearchIndex): string | undefined {
  return meta(db, "embed_model");
}

/** True if every one of these passages is already in the search file, with numbers from `embedModel`. */
export function hasPassages(db: SearchIndex, passageIds: string[], embedModel: string): boolean {
  if (meta(db, "embed_model") !== embedModel) return false;
  const find = db.prepare("select 1 from passages p join passage_vectors v on v.rowid = p.rowid where p.passage_id = ?");
  return passageIds.every((id) => find.get(id) !== undefined);
}

/** Removes a material's passages from the search file. */
export function removeMaterial(db: SearchIndex, materialId: string): void {
  const rows = db.prepare("select rowid from passages where material_id = ?").all(materialId) as { rowid: number }[];
  const hasVec = Boolean(meta(db, "embed_model"));
  const tx = db.transaction(() => {
    for (const { rowid } of rows) {
      db.prepare("delete from passage_fts where rowid = ?").run(BigInt(rowid));
      if (hasVec) db.prepare("delete from passage_vectors where rowid = ?").run(BigInt(rowid));
    }
    db.prepare("delete from passages where material_id = ?").run(materialId);
  });
  tx();
}

/**
 * Adds passages to the search file, replacing any with the same ids.
 * Refuses to mix two meaning models in one file: switching models means rebuilding.
 */
export async function indexPassages(db: SearchIndex, passages: IndexedPassage[], embed: Embedder, embedModel: string, batchSize = 32): Promise<void> {
  if (passages.length === 0) return;
  assertModel(db, embedModel);
  const vectors: number[][] = [];
  for (let i = 0; i < passages.length; i += batchSize) {
    vectors.push(...(await embed(passages.slice(i, i + batchSize).map((p) => p.text), "document")));
  }
  if (vectors.length !== passages.length) throw new Error(`the meaning model returned ${vectors.length} results for ${passages.length} passages`);
  ensureVectorTable(db, embedModel, vectors[0]!.length);

  const find = db.prepare("select rowid from passages where passage_id = ?");
  const tx = db.transaction(() => {
    passages.forEach((p, i) => {
      const existing = find.get(p.passageId) as { rowid: number } | undefined;
      if (existing) {
        db.prepare("delete from passage_fts where rowid = ?").run(BigInt(existing.rowid));
        db.prepare("delete from passage_vectors where rowid = ?").run(BigInt(existing.rowid));
        db.prepare("delete from passages where rowid = ?").run(existing.rowid);
      }
      const { lastInsertRowid } = db
        .prepare("insert into passages (passage_id, material_id, course_id, text) values (?, ?, ?, ?)")
        .run(p.passageId, p.materialId, p.courseId, p.text);
      const rowid = BigInt(lastInsertRowid);
      db.prepare("insert into passage_fts (rowid, text) values (?, ?)").run(rowid, p.text);
      db.prepare("insert into passage_vectors (rowid, course_id, embedding) values (?, ?, ?)").run(rowid, p.courseId, new Float32Array(vectors[i]!));
    });
  });
  tx();
}

/**
 * Finds the passages in one course that best match a text, by keyword and by meaning,
 * and merges the two ranked lists. A keyword match needs at least two words of the text
 * (one if the text has only one word); a meaning match must be closer than
 * {@link MAX_MEANING_DISTANCE}. Returns at most `limit` passages, or none if nothing is related.
 */
export async function searchPassages(
  db: SearchIndex,
  query: { courseId: string; text: string; embed: Embedder; limit?: number; maxDistance?: number },
): Promise<SearchHit[]> {
  const limit = query.limit ?? 8;
  if (!query.text.trim()) return [];
  const scores = new Map<string, number>();
  const add = (ids: string[]) => ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1)));

  const words = contentWords(query.text).slice(0, 32);
  if (words.length) {
    const needed = Math.min(2, words.length);
    const rows = db
      .prepare(
        `select p.passage_id as id, p.text as text from passage_fts f join passages p on p.rowid = f.rowid
         where passage_fts match ? and p.course_id = ? order by bm25(passage_fts) limit ?`,
      )
      .all(words.map((w) => `"${w}"`).join(" OR "), query.courseId, limit * 6) as { id: string; text: string }[];
    add(rows.filter((r) => matchedWords(query.text, r.text) >= needed).map((r) => r.id));
  }

  if (meta(db, "embed_model")) {
    const [vector] = await query.embed([query.text], "query");
    const total = (db.prepare("select count(*) as n from passages where course_id = ?").get(query.courseId) as { n: number }).n;
    // The numbers are split by course, so the closest passages are always this course's own.
    const rows = db
      .prepare(
        `select p.passage_id as id, v.distance as distance from passage_vectors v join passages p on p.rowid = v.rowid
         where v.embedding match ? and k = ? and v.course_id = ? order by v.distance`,
      )
      .all(new Float32Array(vector!), Math.min(Math.max(total, 1), 400), query.courseId) as { id: string; distance: number }[];
    const cutoff = query.maxDistance ?? MAX_MEANING_DISTANCE;
    rows.splice(0, rows.length, ...rows.filter((r) => r.distance <= cutoff));
    add(rows.slice(0, limit * 3).map((r) => r.id));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([passageId, score]) => ({ passageId, score }));
}
