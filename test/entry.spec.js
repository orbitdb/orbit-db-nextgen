import { strictEqual } from 'assert'
import rimraf from 'rimraf'
import { copy } from 'fs-extra'
import Entry from '../src/entry.js'
import IdentityProvider from 'orbit-db-identity-provider'
import Keystore from '../src/Keystore.js'
import { config, testAPIs } from 'orbit-db-test-utils'

const { sync: rmrf } = rimraf
const { createIdentity } = IdentityProvider
const { create, isEntry } = Entry

Object.keys(testAPIs).forEach((IPFS) => {
  describe('Entry (' + IPFS + ')', function () {
    this.timeout(config.timeout)

    const { identityKeyFixtures, signingKeyFixtures, identityKeysPath, signingKeysPath } = config

    let testIdentity
    let keystore, signingKeystore

    before(async () => {
      await copy(identityKeyFixtures, identityKeysPath)
      await copy(signingKeyFixtures, signingKeysPath)

      keystore = new Keystore(identityKeysPath)
      signingKeystore = new Keystore(signingKeysPath)

      testIdentity = await createIdentity({ id: 'userA', keystore, signingKeystore })
    })

    after(async () => {
      await copy(identityKeyFixtures, identityKeysPath)
      await copy(signingKeyFixtures, signingKeysPath)
      rmrf(identityKeysPath)
      rmrf(signingKeysPath)
      await keystore.close()
      await signingKeystore.close()
    })

    describe('create', () => {
      it('creates a an empty entry', async () => {
        // const expectedHash = 'zdpuAsqjGLA4aAGiSNYeTE5zH6e5ayRpgiZrfN2d3UpmzEF76'
        const entry = await create(testIdentity, 'A', 'hello')
        // strictEqual(entry.hash, expectedHash)
        strictEqual(entry.id, 'A')
        strictEqual(entry.clock.id, testIdentity.publicKey)
        strictEqual(entry.clock.time, 0)
        strictEqual(entry.v, 2)
        strictEqual(entry.payload, 'hello')
        strictEqual(entry.next.length, 0)
        strictEqual(entry.refs.length, 0)
      })

      it('creates a entry with payload', async () => {
        // const expectedHash = 'zdpuB2uuvoKD9cmBV8ET5R9KeytY1Jq72LNQrjEpuEyZURP5Q'
        const payload = 'hello world'
        const entry = await create(testIdentity, 'A', payload)
        strictEqual(entry.payload, payload)
        strictEqual(entry.id, 'A')
        strictEqual(entry.clock.id, testIdentity.publicKey)
        strictEqual(entry.clock.time, 0)
        strictEqual(entry.v, 2)
        strictEqual(entry.next.length, 0)
        strictEqual(entry.refs.length, 0)
        // strictEqual(entry.hash, expectedHash)
      })

      it('creates a entry with payload and next', async () => {
        // const expectedHash = 'zdpuApstRF3DCyuuNhPks8sG2qXPf6BFbMA7EeaGrn9Y6ZEzQ'
        const payload1 = 'hello world'
        const payload2 = 'hello again'
        const entry1 = await create(testIdentity, 'A', payload1)
        entry1.clock.tick()
        const entry2 = await create(testIdentity, 'A', payload2, entry1.clock, [entry1])
        strictEqual(entry2.payload, payload2)
        strictEqual(entry2.next.length, 1)
        // strictEqual(entry2.hash, expectedHash)
        strictEqual(entry2.clock.id, testIdentity.publicKey)
        strictEqual(entry2.clock.time, 1)
      })

      it('`next` parameter can be an array of strings', async () => {
        const entry1 = await create(testIdentity, 'A', 'hello1')
        const entry2 = await create(testIdentity, 'A', 'hello2', null, [entry1.hash])
        strictEqual(typeof entry2.next[0] === 'string', true)
      })

      it('throws an error if no params are defined', async () => {
        let err
        try {
          await create()
        } catch (e) {
          err = e
        }
        strictEqual(err.message, 'Identity is required, cannot create entry')
      })

      it('throws an error if identity are not defined', async () => {
        let err
        try {
          await create(null, 'A', 'hello2')
        } catch (e) {
          err = e
        }
        strictEqual(err.message, 'Identity is required, cannot create entry')
      })

      it('throws an error if id is not defined', async () => {
        let err
        try {
          await create(testIdentity, null, 'hello')
        } catch (e) {
          err = e
        }
        strictEqual(err.message, 'Entry requires an id')
      })

      it('throws an error if payload is not defined', async () => {
        let err
        try {
          await create(testIdentity, 'A', null)
        } catch (e) {
          err = e
        }
        strictEqual(err.message, 'Entry requires a payload')
      })

      it('throws an error if next is not an array', async () => {
        let err
        try {
          await create(testIdentity, 'A', 'hello', null, {})
        } catch (e) {
          err = e
        }
        strictEqual(err.message, '\'next\' argument is not an array')
      })
    })

    describe('isEntry', () => {
      it('is an Entry', async () => {
        const entry = await create(testIdentity, 'A', 'hello')
        strictEqual(isEntry(entry), true)
      })

      it('is not an Entry - no id', async () => {
        const fakeEntry = { next: [], v: 1, hash: 'Foo', payload: 123, seq: 0 }
        strictEqual(isEntry(fakeEntry), false)
      })

      it('is not an Entry - no seq', async () => {
        const fakeEntry = { next: [], v: 1, hash: 'Foo', payload: 123 }
        strictEqual(isEntry(fakeEntry), false)
      })

      it('is not an Entry - no next', async () => {
        const fakeEntry = { id: 'A', v: 1, hash: 'Foo', payload: 123, seq: 0 }
        strictEqual(isEntry(fakeEntry), false)
      })

      it('is not an Entry - no version', async () => {
        const fakeEntry = { id: 'A', next: [], payload: 123, seq: 0 }
        strictEqual(isEntry(fakeEntry), false)
      })

      it('is not an Entry - no hash', async () => {
        const fakeEntry = { id: 'A', v: 1, next: [], payload: 123, seq: 0 }
        strictEqual(isEntry(fakeEntry), false)
      })

      it('is not an Entry - no payload', async () => {
        const fakeEntry = { id: 'A', v: 1, next: [], hash: 'Foo', seq: 0 }
        strictEqual(isEntry(fakeEntry), false)
      })
    })
  })
})