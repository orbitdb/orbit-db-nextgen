/**
* @module OrbitDB
* @description
* OrbitDB is a serverless, distributed, peer-to-peer database. OrbitDB uses
* IPFS as its data storage and Libp2p Pubsub to automatically sync databases
* with peers. It's an eventually consistent database that uses Merkle-CRDTs
* for conflict-free database writes and merges making OrbitDB an excellent
* choice for p2p and decentralized apps, blockchain applications and local
* first web applications.
*
* To install OrbitDB:
* ```bash
* npm install orbit-db
* ```
*
* IPFS is also required:
* ```bash
* npm install ipfs-core
* ```
*
* Instantiate OrbitDB and open a new database:
* ```javascript
* import { create } from 'ipfs-core'
* import OrbitDB from 'orbit-db'
*
* const ipfs = await create() // IPFS is required for storage and syncing
* const orbitdb = await OrbitDB({ ipfs })
* const mydb = await orbitdb.open('mydb')
* console.log('mydb address', mydb.address)
* ```
* Once the database has been created, it can be opened again using its
* multiformat address:
* ```
* const dbAddress = '/orbitdb/db-hash' // db-hash will be some multiaddress.
* const mydb = await orbitdb.open(dbAddress)
* ```
*/
import { Events, KeyValue, Documents } from './db/index.js'
import KeyStore from './key-store.js'
import { Identities } from './identities/index.js'
import OrbitDBAddress, { isValidAddress } from './address.js'
import Manifests from './manifest.js'
import { createId } from './utils/index.js'
import pathJoin from './utils/path-join.js'
import * as AccessControllers from './access-controllers/index.js'
import IPFSAccessController from './access-controllers/ipfs.js'

/**
 * An array of available database types.
 * @name databaseTypes
 * @†ype []
 * @return [] An array of database types.
 * @memberof module:OrbitDB
 */
const databaseTypes = {
  events: Events,
  documents: Documents,
  keyvalue: KeyValue
}

/**
 * Add a new database type.
 * @example
 * import { addDatabaseType } from 'orbit-db'
 * const CustomDBTypeModule = async (params) => {
 *   const database = await Database(...params)
 *   ...
 * }
 * addDatabaseType('customDBType', CustomDBTypeModule)
 * @function addDatabaseType
 * @param {String} type The database type.
 * @param {module:Database} store A Database-compatible module.
 * @memberof module:OrbitDB
 */
const addDatabaseType = (type, store) => {
  if (databaseTypes[type]) {
    throw new Error(`Type already exists: ${type}`)
  }
  databaseTypes[type] = store
}

/**
 * The default database type 'events'.
 */
const DefaultDatabaseType = 'events'

/**
 * The default access controller 'IPFSAccessController'.
 */
const DefaultAccessController = IPFSAccessController

/**
 * Creates an instance of OrbitDB.
 * @function
 * @param {Object} params One or more parameters for configuring OrbitDB.
 * @param {IPFS} params.ipfs An IPFS instance.
 * @param {String} [params.id] The id of the OrbitDB instance.
 * @param {Identity} [params.identity] An Identity instance.
 * @param {namespace:KeyStore} [params.keystore] A KeyStore instance.
 * @param {String} [params.directory] A location for storing OrbitDB-related
 * data.
 * @return {module:OrbitDB~OrbitDB} An instance of OrbitDB.
 * @instance
 */
const OrbitDB = async ({ ipfs, id, identity, keystore, directory } = {}) => {
  /**
   * @namespace module:OrbitDB~OrbitDB
   * @description The instance returned by {@link module:OrbitDB}.
   */

  if (ipfs == null) {
    throw new Error('IPFS instance is a required argument. See https://github.com/orbitdb/orbit-db/blob/master/API.md#createinstance')
  }

  id = id || await createId()
  const { id: peerId } = await ipfs.id()
  directory = directory || './orbitdb'
  keystore = keystore || await KeyStore({ path: pathJoin(directory, './keystore') })
  const identities = await Identities({ ipfs, keystore })
  identity = identity || await identities.createIdentity({ id })

  const manifests = await Manifests({ ipfs })

  let databases = {}

  /**
   * Open a database or create one if it does not already exist.
   *
   * By default, OrbitDB will create a database of type <a href="module-OrbitDB.html#~DefaultDatabaseType">DefaultDatabaseType</a>:
   * ```
   * const mydb = await orbitdb.open('mydb')
   * ```
   * To create a database of a different type, specify the type param:
   * ```
   * const mydb = await orbitdb.open('mydb', {type: 'documents'})
   * ```
   * The type must be listed in <a href="module-OrbitDB.html#.databaseTypes">databaseTypes</a> or an error is thrown.
   * @function open
   * @param {String} address The address of an existing database to open, or
   * the name of a new database.
   * @param {Object} params One or more database configuration parameters.
   * @param {*} params.meta The database's metadata.
   * @param {bool} [params.sync=false] If true, sync databases automatically.
   * Otherwise, false.
   * @param {module:Database} [params.Database=Database] A Database-compatible
   * module.
   * @param {module:AccessControllers}
   * [params.AccessController=DefaultAccessController]
   * An AccessController-compatible module.
   * @param {module:Storage} [params.headsStorage] A compatible storage
   * instance for storing log heads.
   * @param {module:Storage} [params.entryStorage] A compatible storage instance
   * for storing log entries.
   * @param {module:Storage} [params.indexStorage] A compatible storage
   * instance for storing an index of log entries.
   * @param {Integer} [params.referencesCount]  The maximum distance between
   * references to other entries.
   * @memberof module:OrbitDB
   * @return {module:Database} A database instance.
   * @throws Unsupported database type if the type specified is not in the list
   * of known databaseTypes.
   * @memberof module:OrbitDB~OrbitDB
   * @instance
   * @async
   */
  const open = async (address, { type, meta, sync, Database, AccessController, headsStorage, entryStorage, indexStorage, referencesCount } = {}) => {
    let name, manifest, accessController

    if (type && !databaseTypes[type]) {
      throw new Error(`Unsupported database type: '${type}'`)
    }

    if (databases[address]) {
      return databases[address]
    }

    if (isValidAddress(address)) {
      // If the address given was a valid OrbitDB address, eg. '/orbitdb/zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13'
      const addr = OrbitDBAddress(address)
      manifest = await manifests.get(addr.path)
      const acType = manifest.accessController.split('/', 2).pop()
      const acAddress = manifest.accessController.replaceAll(`/${acType}/`, '')
      AccessController = AccessControllers.get(acType)()
      accessController = await AccessController({ orbitdb: { open, identity, ipfs }, identities, address: acAddress })
      name = manifest.name
      type = type || manifest.type
      meta = manifest.meta
    } else {
      // If the address given was not valid, eg. just the name of the database
      type = type || DefaultDatabaseType
      AccessController = AccessController || DefaultAccessController()
      accessController = await AccessController({ orbitdb: { open, identity, ipfs }, identities })
      const m = await manifests.create({ name: address, type, accessController: accessController.address, meta })
      manifest = m.manifest
      address = OrbitDBAddress(m.hash)
      name = manifest.name
      meta = manifest.meta
    }

    Database = Database || databaseTypes[type]()

    if (!Database) {
      throw new Error(`Unsupported database type: '${type}'`)
    }

    address = address.toString()

    const db = await Database({ ipfs, identity, address, name, access: accessController, directory, meta, syncAutomatically: sync, headsStorage, entryStorage, indexStorage, referencesCount })

    db.events.on('close', onDatabaseClosed(address))

    databases[address] = db

    return db
  }

  const onDatabaseClosed = (address) => () => {
    delete databases[address]
  }

  /**
   * Stops OrbitDB, closing the underlying keystore and manifest.
   * @function stop
   * @memberof module:OrbitDB~OrbitDB
   * @instance
   * @async
   */
  const stop = async () => {
    if (keystore) {
      await keystore.close()
    }
    if (manifests) {
      await manifests.close()
    }
    databases = {}
  }

  return {
    open,
    stop,
    ipfs,
    directory,
    keystore,
    identity,
    peerId
  }
}

export { OrbitDB as default, OrbitDBAddress, addDatabaseType, databaseTypes, AccessControllers }
