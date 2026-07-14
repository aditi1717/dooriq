const mongoose = require('mongoose')

mongoose.connect('mongodb+srv://dooriqofficial_db_user:aTQ0jC2tnzY5iZL0@cluster0.gshk9cc.mongodb.net/dooriq')
  .then(async () => {
    const db = mongoose.connection.db
    const collections = await db.listCollections().toArray()
    console.log('All collections:')
    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments()
      console.log(`  ${col.name}: ${count} documents`)
    }

    mongoose.disconnect()
  })
  .catch(e => {
    console.error('Error:', e.message)
    process.exit(1)
  })
