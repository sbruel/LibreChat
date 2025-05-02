const express = require('express');

const paths = require('~/config/paths');
const { isEnabled } = require('~/server/utils');

const router = express.Router();
if (isEnabled(process.env.DISABLE_IMAGES_OUTPUT_STATIC_CACHE)) {
  router.use(express.static(paths.imageOutput));
} else {
  const staticCache = require('../utils/staticCache');
  router.use(staticCache(paths.imageOutput));
}
