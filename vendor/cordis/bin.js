#!/usr/bin/env node

import { Context } from '@flowforge/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@flowforge/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@flowforge/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
