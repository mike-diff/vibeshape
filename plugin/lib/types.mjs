export const COVERAGE_LEVELS = ['missing', 'gap', 'partial', 'covered', 'linked', 'verified'];
export const IMPORTANCE_LEVELS = ['core', 'high', 'normal', 'low'];
export const EVIDENCE_TYPES = ['file', 'test', 'other'];

/**
 * linked and verified both cite named tests; only verified means those tests
 * were executed and passed at assertion time. linked is the honest resting
 * place for a claim whose tests exist but were never run by the tool.
 *
 * @typedef {'missing'|'gap'|'partial'|'covered'|'linked'|'verified'} Coverage
 * @typedef {'core'|'high'|'normal'|'low'} Importance
 *
 * @typedef {object} Evidence
 * @property {'file'|'test'|'other'} type
 * @property {string} path
 * @property {string} [name]   Test name or human label within the path.
 * @property {string} [hash]   Short sha256 of the file content at assessment.
 *
 * @typedef {object} Assessed
 * @property {string} at        ISO date of the last coverage assessment.
 * @property {string} [gitRef]  Short git SHA the assessment was made against.
 *
 * @typedef {object} ShapeNode
 * @property {string} id            Path-like slug: `area/child/leaf`.
 * @property {string} title
 * @property {string} [intent]      EARS-style intent statement.
 * @property {Coverage} [coverage]  Asserted on leaves; parents derive.
 * @property {boolean} [suspect]    Set by audit on drift; cleared by review.
 * @property {string} [gap]         The steerable delta: what is missing.
 * @property {Importance} [importance]
 * @property {Evidence[]} [evidence]
 * @property {Assessed} [assessed]
 * @property {ShapeNode[]} [children]
 *
 * @typedef {object} Manifest
 * @property {string} name
 * @property {1} schemaVersion
 * @property {string[]} areas   Top-level area slugs in display order.
 *
 * @typedef {object} Shape
 * @property {Manifest} manifest
 * @property {ShapeNode[]} areas
 */
