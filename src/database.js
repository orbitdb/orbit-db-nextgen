import { Level } from 'level'
import { EventEmitter } from 'events'

const valueEncoding = 'view'
const defaultPointerCount = 16

const Database = async ({ OpLog, ipfs, identity, databaseId, accessController, storage }) => {
  const { Log, Entry, IPFSBlockStorage } = OpLog

  storage = storage || await IPFSBlockStorage({ ipfs, pin: true })

  const path = `./${identity.id}/${databaseId}/_state`
  const stateStorage = new Level(path, { valueEncoding })
  await stateStorage.open()

  const log = await Log(identity, { logId: databaseId, access: accessController, storage, stateStorage })

  const events = new EventEmitter()

  const addOperation = async (op) => {
    const entry = await log.append(op, { pointerCount: defaultPointerCount })
    await ipfs.pubsub.publish(databaseId, entry.bytes)
    events.emit('update', entry)
    return entry.hash
  }

  const handleMessage = async (message) => {
    const { id: peerId } = await ipfs.id()
    const messageIsNotFromMe = (message) => String(peerId) !== String(message.from)
    const messageHasData = (message) => message.data !== undefined
    try {
      if (messageIsNotFromMe(message) && messageHasData(message)) {
        await sync(message.data)
      }
    } catch (e) {
      events.emit('error', e)
      console.error(e)
    }
  }

  const sync = async (bytes) => {
    const entry = await Entry.decode(bytes)
    if (entry) {
      events.emit('sync', entry)
      const updated = await log.joinEntry(entry)
      if (updated) {
        events.emit('update', entry)
      }
    }
  }

  const close = async () => {
    await stateStorage.close()
    await storage.close()
    await ipfs.pubsub.unsubscribe(log.id, handleMessage)
    events.emit('close')
  }

  // TODO: rename to clear()
  const drop = async () => {
    await stateStorage.clear()
    await storage.clear()
  }

  const merge = async (other) => {}

  // Automatically subscribe to the pubsub channel for this database
  await ipfs.pubsub.subscribe(log.id, handleMessage)

  return {
    databaseId,
    identity,
    sync,
    merge,
    close,
    drop,
    addOperation,
    log,
    events
  }
}

export default Database