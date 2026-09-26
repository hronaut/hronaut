import type { HomeBootstrap } from '../../shared/home.js'
import { mountHome } from './home/controller.js'
import './styles/tokens.css'
import './home/theme.css'

const bootstrap = document.getElementById('home-bootstrap')
if (!bootstrap?.textContent) throw new Error('Home bootstrap unavailable')
const data = JSON.parse(bootstrap.textContent) as HomeBootstrap
bootstrap.remove()
export const homeController = mountHome(data, window.hronautHome, (...args) => window.fetch(...args))
