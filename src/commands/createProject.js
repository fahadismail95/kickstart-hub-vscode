const vscode = require('vscode')
const path = require('path')
const fs = require('fs-extra')
const https = require('https')
const { promisify } = require('util')
const { exec } = require('child_process')
const execAsync = promisify(exec)

// GitHub configuration
const GITHUB_CONFIG = {
	owner: 'fahadismail95', // Change this to your GitHub username
	repo: 'kickstart-hub-templates',
	branch: 'master',
	baseUrl: 'https://api.github.com/repos',
	rawUrl: 'https://raw.githubusercontent.com',
}

// Cache configuration
const CACHE_CONFIG = {
	maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
	registryFile: 'template-registry.json',
	templatesDir: 'templates',
}

// Project scope configurations
const PROJECT_SCOPES = {
	minimal: {
		key: 'minimal',
		icon: '📦',
		description: 'Basic setup with essential dependencies only',
		features: ['Basic configuration', 'Minimal dependencies', 'Quick start'],
	},
	standard: {
		key: 'standard',
		icon: '🔧',
		description: 'Standard setup with common tools and configurations',
		features: [
			'Linting & formatting',
			'Basic testing setup',
			'Development tools',
			'Common utilities',
		],
	},
	enterprise: {
		key: 'enterprise',
		icon: '🏢',
		description: 'Full-featured setup with testing, CI/CD, and best practices',
		features: [
			'Complete testing suite',
			'CI/CD pipelines',
			'Code quality tools',
			'Documentation',
			'Security scanning',
			'Monitoring',
		],
	},
}

async function createProject() {
	try {
		// Step 1: Update template registry
		await updateTemplateRegistry()

		// Step 2: Select Framework from GitHub registry
		const framework = await selectFrameworkWithCategory()
		if (!framework) return

		// Step 3: Select Project Scope
		const scope = await selectProjectScope(framework)
		if (!scope) return

		// Step 4: Get Project Name
		const projectName = await getProjectName()
		if (!projectName) return

		// Step 5: Select Target Location
		const targetLocation = await selectTargetLocation()
		if (!targetLocation) return

		// Step 6: Additional Configuration
		const additionalConfig = await getAdditionalConfiguration(framework)

		// Step 7: Confirm Configuration
		const confirmed = await confirmProjectCreation(
			framework,
			scope,
			projectName,
			targetLocation,
			additionalConfig
		)
		if (!confirmed) return

		// Step 8: Create Project from GitHub
		await createProjectFromGitHub(
			framework,
			scope,
			projectName,
			targetLocation,
			additionalConfig
		)
	} catch (error) {
		vscode.window.showErrorMessage(`Error creating project: ${error.message}`)
		console.error('KickStart Hub Error:', error)
	}
}

async function updateTemplateRegistry() {
	const extensionPath = getExtensionPath()
	if (!extensionPath) return

	const cacheDir = path.join(extensionPath, 'cache')
	const registryPath = path.join(cacheDir, CACHE_CONFIG.registryFile)

	await fs.ensureDir(cacheDir)

	try {
		// Check if we need to update the registry
		const shouldUpdate = await shouldUpdateRegistry(registryPath)

		if (shouldUpdate) {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Window,
					title: 'Updating templates...',
					cancellable: false,
				},
				async (progress) => {
					progress.report({ message: 'Fetching latest templates from GitHub...' })

					const registryUrl = `${GITHUB_CONFIG.rawUrl}/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/${GITHUB_CONFIG.branch}/template-registry.json`
					const registryData = await downloadFile(registryUrl)

					await fs.writeFile(registryPath, registryData)

					// Update cache timestamp
					const cacheInfo = {
						lastUpdated: Date.now(),
						registryVersion: JSON.parse(registryData).version,
					}
					await fs.writeFile(
						path.join(cacheDir, 'cache-info.json'),
						JSON.stringify(cacheInfo, null, 2)
					)
				}
			)
		}
	} catch (error) {
		console.error('Failed to update template registry:', error)
		// Continue with cached version if available
		if (!(await fs.pathExists(registryPath))) {
			throw new Error(
				'Could not fetch templates from GitHub. Please check your internet connection and try again.'
			)
		}
	}
}

async function shouldUpdateRegistry(registryPath) {
	// Always update if registry doesn't exist
	if (!(await fs.pathExists(registryPath))) {
		return true
	}

	// Check cache age
	const cacheInfoPath = path.join(path.dirname(registryPath), 'cache-info.json')
	if (!(await fs.pathExists(cacheInfoPath))) {
		return true
	}

	try {
		const cacheInfo = await fs.readJson(cacheInfoPath)
		const now = Date.now()
		const cacheAge = now - cacheInfo.lastUpdated

		return cacheAge > CACHE_CONFIG.maxAge
	} catch (error) {
		return true
	}
}

async function getTemplateRegistry() {
	const extensionPath = getExtensionPath()
	if (!extensionPath) return null

	const registryPath = path.join(extensionPath, 'cache', CACHE_CONFIG.registryFile)

	try {
		if (await fs.pathExists(registryPath)) {
			return await fs.readJson(registryPath)
		}
	} catch (error) {
		console.error('Error reading template registry:', error)
	}

	return null
}

async function selectFrameworkWithCategory() {
	const registry = await getTemplateRegistry()
	if (!registry) {
		throw new Error(
			'Template registry not available. Please check your internet connection and try again.'
		)
	}

	// Group templates by category
	const categories = {}
	Object.entries(registry.templates).forEach(([key, template]) => {
		const category = template.category || 'Other'
		if (!categories[category]) {
			categories[category] = []
		}
		categories[category].push({ key, ...template })
	})

	// First, let user choose category or search all
	const categoryItems = [
		{
			label: '🔍 Search All Frameworks',
			description: 'Browse all available frameworks',
			detail: 'all',
		},
		{
			label: '💡 Popular Frameworks',
			description: 'Most commonly used frameworks',
			detail: 'popular',
		},
		...Object.keys(categories)
			.sort()
			.map((category) => ({
				label: `📁 ${category}`,
				description: `Browse ${category.toLowerCase()}`,
				detail: category,
			})),
	]

	const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
		placeHolder: 'Select a category or search all frameworks',
		ignoreFocusOut: true,
		matchOnDescription: true,
	})

	if (!selectedCategory) return null

	let frameworkOptions = []

	if (selectedCategory.detail === 'all') {
		// Show all frameworks
		frameworkOptions = Object.entries(registry.templates)
			.map(([key, template]) => ({
				label: `${template.icon} ${template.name}`,
				description: template.description,
				detail: `${template.category} | ${template.tags.join(', ')} | Updated: ${new Date(
					template.lastUpdated
				).toLocaleDateString()}`,
				framework: key,
				template: template,
			}))
			.sort((a, b) => a.template.name.localeCompare(b.template.name))
	} else if (selectedCategory.detail === 'popular') {
		// Show popular frameworks (you can define these)
		const popularKeys = [
			'react-vite',
			'react-nextjs',
			'vue',
			'angular',
			'express-nodejs',
			'fastapi-python',
			'django-python',
			'spring-boot-java',
			'aspnet-core-csharp',
			'laravel-php',
		]
		frameworkOptions = popularKeys
			.filter((key) => registry.templates[key])
			.map((key) => {
				const template = registry.templates[key]
				return {
					label: `${template.icon} ${template.name}`,
					description: template.description,
					detail: `${template.category} | ${template.tags.join(', ')}`,
					framework: key,
					template: template,
				}
			})
	} else {
		// Show frameworks from selected category
		const categoryFrameworks = categories[selectedCategory.detail]
		frameworkOptions = categoryFrameworks
			.map((template) => ({
				label: `${template.icon} ${template.name}`,
				description: template.description,
				detail: `${template.tags.join(', ')} | Updated: ${new Date(
					template.lastUpdated
				).toLocaleDateString()}`,
				framework: template.key,
				template: template,
			}))
			.sort((a, b) => a.template.name.localeCompare(b.template.name))
	}

	const selectedFramework = await vscode.window.showQuickPick(frameworkOptions, {
		placeHolder: 'Select a framework',
		ignoreFocusOut: true,
		matchOnDescription: true,
		matchOnDetail: true,
	})

	return selectedFramework
		? {
				key: selectedFramework.framework,
				...selectedFramework.template,
		  }
		: null
}

async function selectProjectScope(framework) {
	// Get available scopes from the framework definition
	const availableScopes = framework.scopes || ['minimal', 'standard', 'enterprise']

	const scopeItems = availableScopes.map((scopeKey) => {
		const scopeConfig = PROJECT_SCOPES[scopeKey] || {
			icon: '📦',
			description: `${scopeKey} configuration`,
			features: [],
		}

		return {
			label: `${scopeConfig.icon} ${scopeKey.charAt(0).toUpperCase() + scopeKey.slice(1)}`,
			description: scopeConfig.description,
			detail: scopeConfig.features ? `Features: ${scopeConfig.features.join(', ')}` : '',
			scope: scopeKey,
		}
	})

	const selected = await vscode.window.showQuickPick(scopeItems, {
		placeHolder: 'Select project scope',
		ignoreFocusOut: true,
	})

	return selected ? selected.scope : null
}

async function getProjectName() {
	const projectName = await vscode.window.showInputBox({
		prompt: 'Enter project name',
		placeHolder: 'my-awesome-project',
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return 'Project name cannot be empty'
			}
			if (!/^[a-zA-Z0-9-_\.]+$/.test(value)) {
				return 'Project name can only contain letters, numbers, hyphens, underscores, and dots'
			}
			if (value.length > 50) {
				return 'Project name must be less than 50 characters'
			}
			if (value.startsWith('-') || value.endsWith('-')) {
				return 'Project name cannot start or end with a hyphen'
			}
			return null
		},
	})

	return projectName?.trim()
}

async function selectTargetLocation() {
	const options = ['Select Folder', 'Use Current Workspace', 'Use Default Location']
	const choice = await vscode.window.showQuickPick(options, {
		placeHolder: 'Choose target location',
		ignoreFocusOut: true,
	})

	if (!choice) return null

	switch (choice) {
		case 'Select Folder':
			const targetUri = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Select target folder',
				title: 'Choose where to create your project',
			})
			return targetUri && targetUri.length > 0 ? targetUri[0].fsPath : null

		case 'Use Current Workspace':
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('No workspace folder is open')
				return null
			}
			return workspaceFolder.uri.fsPath

		case 'Use Default Location':
			const os = require('os')
			const defaultPath = path.join(os.homedir(), 'Projects')
			try {
				await fs.ensureDir(defaultPath)
				return defaultPath
			} catch (error) {
				vscode.window.showErrorMessage('Could not create default projects directory')
				return null
			}
	}
}

async function getAdditionalConfiguration(framework) {
	const config = {}

	// Package manager selection for JavaScript/Node.js frameworks
	if (framework.tags.includes('javascript') || framework.tags.includes('typescript')) {
		const packageManager = await vscode.window.showQuickPick(
			[
				{ label: '📦 npm', value: 'npm' },
				{ label: '🧶 yarn', value: 'yarn' },
				{ label: '📦 pnpm', value: 'pnpm' },
				{ label: '🥖 bun', value: 'bun' },
			],
			{
				placeHolder: 'Select package manager (optional)',
				ignoreFocusOut: true,
			}
		)
		if (packageManager) config.packageManager = packageManager.value
	}

	// Database selection for backend frameworks
	if (framework.tags.includes('backend') || framework.tags.includes('fullstack')) {
		const database = await vscode.window.showQuickPick(
			[
				{ label: '🐘 PostgreSQL', value: 'postgresql' },
				{ label: '🍃 MongoDB', value: 'mongodb' },
				{ label: '🐬 MySQL', value: 'mysql' },
				{ label: '🪶 SQLite', value: 'sqlite' },
				{ label: '🔴 Redis', value: 'redis' },
				{ label: '⚡ None', value: 'none' },
			],
			{
				placeHolder: 'Select database (optional)',
				ignoreFocusOut: true,
			}
		)
		if (database) config.database = database.value
	}

	// Authentication options
	if (framework.tags.includes('fullstack') || framework.tags.includes('backend')) {
		const auth = await vscode.window.showQuickPick(
			[
				{ label: '🔐 JWT', value: 'jwt' },
				{ label: '🔑 OAuth 2.0', value: 'oauth' },
				{ label: '🛡️ Passport.js', value: 'passport' },
				{ label: '🆔 Auth0', value: 'auth0' },
				{ label: '🔓 None', value: 'none' },
			],
			{
				placeHolder: 'Select authentication method (optional)',
				ignoreFocusOut: true,
			}
		)
		if (auth) config.authentication = auth.value
	}

	// CSS framework for frontend projects
	if (framework.tags.includes('frontend')) {
		const cssFramework = await vscode.window.showQuickPick(
			[
				{ label: '🎨 Tailwind CSS', value: 'tailwind' },
				{ label: '🅱️ Bootstrap', value: 'bootstrap' },
				{ label: '🎭 Material-UI', value: 'mui' },
				{ label: '🎪 Chakra UI', value: 'chakra' },
				{ label: '💅 Styled Components', value: 'styled-components' },
				{ label: '🎨 Ant Design', value: 'antd' },
				{ label: '📝 Plain CSS', value: 'plain' },
			],
			{
				placeHolder: 'Select CSS framework (optional)',
				ignoreFocusOut: true,
			}
		)
		if (cssFramework) config.cssFramework = cssFramework.value
	}

	// Additional features
	const features = await vscode.window.showQuickPick(
		[
			{ label: '🔍 ESLint + Prettier', value: 'linting', picked: true },
			{ label: '🧪 Testing Setup', value: 'testing', picked: true },
			{ label: '📚 Storybook', value: 'storybook' },
			{ label: '📊 Analytics', value: 'analytics' },
			{ label: '🐳 Docker', value: 'docker' },
			{ label: '📝 Documentation', value: 'docs' },
			{ label: '🔄 GitHub Actions', value: 'github-actions' },
			{ label: '🎯 TypeScript', value: 'typescript' },
			{ label: '🔥 Hot Reload', value: 'hot-reload' },
			{ label: '📈 Monitoring', value: 'monitoring' },
		],
		{
			placeHolder: 'Select additional features (optional)',
			canPickMany: true,
			ignoreFocusOut: true,
		}
	)

	if (features && features.length > 0) {
		config.features = features.map((f) => f.value)
	}

	return config
}

async function confirmProjectCreation(
	framework,
	scope,
	projectName,
	targetLocation,
	additionalConfig = {}
) {
	const scopeConfig = PROJECT_SCOPES[scope]

	let configDetails = []
	if (additionalConfig.packageManager)
		configDetails.push(`📦 Package Manager: ${additionalConfig.packageManager}`)
	if (additionalConfig.database && additionalConfig.database !== 'none')
		configDetails.push(`🗄️ Database: ${additionalConfig.database}`)
	if (additionalConfig.authentication && additionalConfig.authentication !== 'none')
		configDetails.push(`🔐 Auth: ${additionalConfig.authentication}`)
	if (additionalConfig.cssFramework && additionalConfig.cssFramework !== 'plain')
		configDetails.push(`🎨 CSS: ${additionalConfig.cssFramework}`)
	if (additionalConfig.features && additionalConfig.features.length > 0)
		configDetails.push(`✨ Features: ${additionalConfig.features.join(', ')}`)

	const configText = configDetails.length > 0 ? `\n\n${configDetails.join('\n')}` : ''

	const message = `Create ${framework.icon} ${framework.name} project?
    
📁 Name: ${projectName}
🎯 Scope: ${scopeConfig.icon} ${scope}
📍 Location: ${targetLocation}${configText}
    
This will create a new folder "${projectName}" in the selected location.`

	const choice = await vscode.window.showInformationMessage(
		message,
		{ modal: true },
		'Create Project',
		'Cancel'
	)

	return choice === 'Create Project'
}

async function createProjectFromGitHub(
	framework,
	scope,
	projectName,
	targetLocation,
	additionalConfig = {}
) {
	const projectPath = path.join(targetLocation, projectName)

	// Check if target directory already exists
	if (await fs.pathExists(projectPath)) {
		const overwrite = await vscode.window.showWarningMessage(
			`Folder "${projectName}" already exists. What would you like to do?`,
			{ modal: true },
			'Overwrite',
			'Merge',
			'Cancel'
		)

		if (overwrite === 'Cancel') return
		if (overwrite === 'Overwrite') await fs.remove(projectPath)
	}

	// Show progress
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Creating ${framework.name} project...`,
			cancellable: false,
		},
		async (progress) => {
			progress.report({ increment: 0, message: 'Downloading template from GitHub...' })

			// Download template from GitHub
			await downloadTemplateFromGitHub(framework.key, scope, projectPath, progress)

			progress.report({ increment: 60, message: 'Processing template...' })

			// Process template files
			await processTemplateFiles(
				projectPath,
				projectName,
				framework.name,
				scope,
				additionalConfig
			)

			progress.report({ increment: 80, message: 'Applying configurations...' })

			// Apply additional configurations
			await applyAdditionalConfigurations(projectPath, framework, additionalConfig)

			progress.report({ increment: 95, message: 'Finalizing project...' })

			// Run post-creation scripts
			await runPostCreationScripts(projectPath, framework, additionalConfig)

			progress.report({ increment: 100, message: 'Project created successfully!' })
		}
	)

	// Show success message with actions
	const action = await vscode.window.showInformationMessage(
		`✅ ${framework.name} (${scope}) project "${projectName}" created successfully!`,
		'Open Project',
		'Open in New Window',
		'Show in Explorer',
		'Install Dependencies'
	)

	await handlePostCreationAction(action, projectPath, framework, additionalConfig)
}

async function downloadTemplateFromGitHub(frameworkKey, scope, projectPath, progress) {
	try {
		// Method 1: Use GitHub API to get folder contents (recommended for small templates)
		await downloadTemplateViaAPI(frameworkKey, scope, projectPath, progress)
	} catch (error) {
		console.error('API download failed, trying git clone:', error)
		try {
			// Method 2: Fallback to sparse git clone (for larger templates)
			await downloadTemplateViaGit(frameworkKey, scope, projectPath, progress)
		} catch (gitError) {
			throw new Error(
				`Template not found or could not be downloaded: ${frameworkKey}/${scope}. Please check if the template exists in the repository.`
			)
		}
	}
}

async function downloadTemplateViaAPI(frameworkKey, scope, projectPath, progress) {
	const templatePath = `templates/${frameworkKey}/${scope}`
	const apiUrl = `${GITHUB_CONFIG.baseUrl}/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${templatePath}?ref=${GITHUB_CONFIG.branch}`

	await fs.ensureDir(projectPath)

	try {
		// Get directory contents
		const response = await downloadJson(apiUrl)

		if (!Array.isArray(response)) {
			throw new Error(`Template not found: ${frameworkKey}/${scope}`)
		}

		// Download all files
		const totalFiles = await countTotalFiles(response)
		let downloadedFiles = 0

		for (const item of response) {
			await downloadFileRecursively(item, projectPath, (fileCount) => {
				downloadedFiles += fileCount
				progress.report({
					increment: (30 / totalFiles) * fileCount,
					message: `Downloaded ${downloadedFiles}/${totalFiles} files...`,
				})
			})
		}
	} catch (error) {
		if (error.message.includes('404') || error.message.includes('Not Found')) {
			throw new Error(
				`Template not found: ${frameworkKey}/${scope}. Please ensure the template exists in the GitHub repository.`
			)
		}
		throw error
	}
}

async function countTotalFiles(items) {
	let count = 0
	for (const item of items) {
		if (item.type === 'file') {
			count++
		} else if (item.type === 'dir') {
			try {
				const dirContents = await downloadJson(item.url)
				if (Array.isArray(dirContents)) {
					count += await countTotalFiles(dirContents)
				}
			} catch (error) {
				// Skip directories that can't be accessed
				console.warn(`Could not access directory: ${item.name}`)
			}
		}
	}
	return count
}

async function downloadFileRecursively(item, basePath, onFileDownloaded) {
	const filePath = path.join(basePath, item.name)

	if (item.type === 'file') {
		// Download file
		const fileContent = await downloadFile(item.download_url)
		await fs.writeFile(filePath, fileContent)
		onFileDownloaded(1)
	} else if (item.type === 'dir') {
		// Create directory and download contents
		await fs.ensureDir(filePath)
		try {
			const dirContents = await downloadJson(item.url)

			if (Array.isArray(dirContents)) {
				for (const subItem of dirContents) {
					await downloadFileRecursively(subItem, basePath, onFileDownloaded)
				}
			}
		} catch (error) {
			console.warn(`Could not download directory contents: ${item.name}`)
		}
	}
}

async function downloadTemplateViaGit(frameworkKey, scope, projectPath, progress) {
	const tempDir = path.join(require('os').tmpdir(), `kickstart-${Date.now()}`)
	const templatePath = `templates/${frameworkKey}/${scope}`

	try {
		// Clone repository with sparse checkout
		await execAsync(`git clone --filter=blob:none --sparse ${getGitUrl()} "${tempDir}"`)

		// Set sparse checkout to only include the template we need
		await execAsync(`git sparse-checkout set "${templatePath}"`, { cwd: tempDir })

		// Copy template to project path
		const sourcePath = path.join(tempDir, templatePath)
		if (await fs.pathExists(sourcePath)) {
			await fs.copy(sourcePath, projectPath)
		} else {
			throw new Error(`Template path not found: ${templatePath}`)
		}
	} finally {
		// Cleanup temp directory
		if (await fs.pathExists(tempDir)) {
			await fs.remove(tempDir)
		}
	}
}

function getGitUrl() {
	return `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}.git`
}

async function processTemplateFiles(
	projectPath,
	projectName,
	frameworkName,
	scope,
	additionalConfig
) {
	try {
		// Get all files in the project
		const files = await getAllFiles(projectPath)

		// Define replacement variables
		const replacements = {
			'{{PROJECT_NAME}}': projectName,
			'{{PROJECT_NAME_KEBAB}}': projectName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
			'{{PROJECT_NAME_SNAKE}}': projectName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
			'{{PROJECT_NAME_PASCAL}}': projectName.replace(/[-_\s]+(.)?/g, (_, c) =>
				c ? c.toUpperCase() : ''
			),
			'{{PROJECT_NAME_CAMEL}}': projectName.replace(/[-_\s]+(.)?/g, (_, c, index) =>
				index === 0 ? c?.toLowerCase() : c?.toUpperCase()
			),
			'{{FRAMEWORK}}': frameworkName,
			'{{SCOPE}}': scope,
			'{{CURRENT_YEAR}}': new Date().getFullYear().toString(),
			'{{CURRENT_DATE}}': new Date().toISOString().split('T')[0],
			'{{PACKAGE_MANAGER}}': additionalConfig.packageManager || 'npm',
			'{{DATABASE}}': additionalConfig.database || 'none',
			'{{AUTHENTICATION}}': additionalConfig.authentication || 'none',
			'{{CSS_FRAMEWORK}}': additionalConfig.cssFramework || 'plain',
			'{{AUTHOR_NAME}}': process.env.USER || process.env.USERNAME || 'Developer',
			'{{DESCRIPTION}}': `A ${frameworkName} project created with KickStart Hub`,
		}

		// Process each file
		for (const filePath of files) {
			const relativePath = path.relative(projectPath, filePath)

			// Skip binary files and node_modules
			if (isBinaryFile(relativePath) || relativePath.includes('node_modules')) continue

			try {
				let content = await fs.readFile(filePath, 'utf8')
				let modified = false

				// Apply replacements
				for (const [placeholder, replacement] of Object.entries(replacements)) {
					if (content.includes(placeholder)) {
						content = content.replace(new RegExp(placeholder, 'g'), replacement)
						modified = true
					}
				}

				// Write back if modified
				if (modified) {
					await fs.writeFile(filePath, content)
				}
			} catch (error) {
				// Skip files that can't be processed as text
				console.log(`Skipping file processing for: ${relativePath}`)
			}
		}
	} catch (error) {
		console.error('Error processing template files:', error)
	}
}

async function getAllFiles(dir) {
	let results = []
	try {
		const list = await fs.readdir(dir)

		for (const file of list) {
			const filePath = path.join(dir, file)
			const stat = await fs.stat(filePath)

			if (stat.isDirectory()) {
				results = results.concat(await getAllFiles(filePath))
			} else {
				results.push(filePath)
			}
		}
	} catch (error) {
		console.error(`Error reading directory ${dir}:`, error)
	}

	return results
}

function isBinaryFile(filePath) {
	const binaryExtensions = [
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.ico',
		'.svg',
		'.webp',
		'.woff',
		'.woff2',
		'.ttf',
		'.eot',
		'.otf',
		'.mp4',
		'.mp3',
		'.wav',
		'.avi',
		'.mov',
		'.pdf',
		'.zip',
		'.tar',
		'.gz',
		'.rar',
		'.exe',
		'.dll',
		'.so',
		'.dylib',
	]
	return binaryExtensions.some((ext) => filePath.toLowerCase().endsWith(ext))
}

async function applyAdditionalConfigurations(projectPath, framework, additionalConfig) {
	try {
		// Apply package manager specific configurations
		if (additionalConfig.packageManager && framework.tags.includes('javascript')) {
			await applyPackageManagerConfig(projectPath, additionalConfig.packageManager)
		}

		// Apply database configurations
		if (additionalConfig.database && additionalConfig.database !== 'none') {
			await applyDatabaseConfig(projectPath, additionalConfig.database, framework)
		}

		// Apply CSS framework configurations
		if (additionalConfig.cssFramework && additionalConfig.cssFramework !== 'plain') {
			await applyCSSFrameworkConfig(projectPath, additionalConfig.cssFramework, framework)
		}

		// Apply feature configurations
		if (additionalConfig.features) {
			await applyFeatureConfigurations(projectPath, additionalConfig.features, framework)
		}
	} catch (error) {
		console.error('Error applying additional configurations:', error)
	}
}

async function applyPackageManagerConfig(projectPath, packageManager) {
	// Create package manager specific files
	switch (packageManager) {
		case 'yarn':
			await fs.writeFile(path.join(projectPath, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
			break
		case 'pnpm':
			await fs.writeFile(
				path.join(projectPath, '.npmrc'),
				'shamefully-hoist=true\nauto-install-peers=true\n'
			)
			break
		case 'bun':
			await fs.writeFile(
				path.join(projectPath, 'bunfig.toml'),
				'[install]\nregistry = "https://registry.npmjs.org/"\n'
			)
			break
	}
}

async function applyDatabaseConfig(projectPath, database, framework) {
	// Add database-specific configuration files or dependencies
	const configFiles = {
		postgresql: {
			'.env.example':
				'DATABASE_URL=postgresql://username:password@localhost:5432/{{PROJECT_NAME}}\nPOSTGRES_DB={{PROJECT_NAME}}\nPOSTGRES_USER=user\nPOSTGRES_PASSWORD=password\n',
			'docker-compose.yml': `version: '3.8'
services:
 postgres:
   image: postgres:15
   environment:
     POSTGRES_DB: {{PROJECT_NAME}}
     POSTGRES_USER: user
     POSTGRES_PASSWORD: password
   ports:
     - "5432:5432"
   volumes:
     - postgres_data:/var/lib/postgresql/data
   healthcheck:
     test: ["CMD-SHELL", "pg_isready -U user -d {{PROJECT_NAME}}"]
     interval: 30s
     timeout: 10s
     retries: 3

volumes:
 postgres_data:
`,
		},
		mongodb: {
			'.env.example':
				'MONGODB_URI=mongodb://localhost:27017/{{PROJECT_NAME}}\nMONGO_INITDB_ROOT_USERNAME=admin\nMONGO_INITDB_ROOT_PASSWORD=password\n',
			'docker-compose.yml': `version: '3.8'
services:
 mongodb:
   image: mongo:6
   environment:
     MONGO_INITDB_ROOT_USERNAME: admin
     MONGO_INITDB_ROOT_PASSWORD: password
     MONGO_INITDB_DATABASE: {{PROJECT_NAME}}
   ports:
     - "27017:27017"
   volumes:
     - mongodb_data:/data/db
   healthcheck:
     test: echo 'db.runCommand("ping").ok' | mongosh localhost:27017/{{PROJECT_NAME}} --quiet
     interval: 30s
     timeout: 10s
     retries: 3

volumes:
 mongodb_data:
`,
		},
		mysql: {
			'.env.example':
				'DATABASE_URL=mysql://user:password@localhost:3306/{{PROJECT_NAME}}\nMYSQL_ROOT_PASSWORD=rootpassword\nMYSQL_DATABASE={{PROJECT_NAME}}\nMYSQL_USER=user\nMYSQL_PASSWORD=password\n',
			'docker-compose.yml': `version: '3.8'
services:
 mysql:
   image: mysql:8.0
   environment:
     MYSQL_ROOT_PASSWORD: rootpassword
     MYSQL_DATABASE: {{PROJECT_NAME}}
     MYSQL_USER: user
     MYSQL_PASSWORD: password
   ports:
     - "3306:3306"
   volumes:
     - mysql_data:/var/lib/mysql
   healthcheck:
     test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
     interval: 30s
     timeout: 10s
     retries: 3

volumes:
 mysql_data:
`,
		},
		redis: {
			'.env.example': 'REDIS_URL=redis://localhost:6379\nREDIS_PASSWORD=password\n',
			'docker-compose.yml': `version: '3.8'
services:
 redis:
   image: redis:7-alpine
   command: redis-server --requirepass password
   ports:
     - "6379:6379"
   volumes:
     - redis_data:/data
   healthcheck:
     test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
     interval: 30s
     timeout: 10s
     retries: 3

volumes:
 redis_data:
`,
		},
		sqlite: {
			'.env.example': 'DATABASE_URL=sqlite:./{{PROJECT_NAME}}.db\n',
		},
	}

	if (configFiles[database]) {
		for (const [fileName, content] of Object.entries(configFiles[database])) {
			const filePath = path.join(projectPath, fileName)

			// Replace placeholders in the content
			const processedContent = content.replace(/{{PROJECT_NAME}}/g, path.basename(projectPath))

			await fs.writeFile(filePath, processedContent)
		}
	}
}

async function applyCSSFrameworkConfig(projectPath, cssFramework, framework) {
	// Add CSS framework specific configuration
	const cssConfigs = {
		tailwind: {
			'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
module.exports = {
 content: [
   "./src/**/*.{js,jsx,ts,tsx,vue,html}",
   "./public/index.html"
 ],
 theme: {
   extend: {},
 },
 plugins: [],
}
`,
			'src/styles/globals.css':
				'@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n/* Custom styles */\n',
			'postcss.config.js': `module.exports = {
 plugins: {
   tailwindcss: {},
   autoprefixer: {},
 },
}
`,
		},
		bootstrap: {
			'src/styles/globals.css':
				'@import "bootstrap/dist/css/bootstrap.min.css";\n\n/* Custom styles */\n',
		},
		mui: {
			'src/theme/theme.js': `import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
 palette: {
   mode: 'light',
   primary: {
     main: '#1976d2',
   },
   secondary: {
     main: '#dc004e',
   },
 },
});
`,
		},
		chakra: {
			'src/theme/theme.js': `import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
 colors: {
   brand: {
     100: "#f7fafc",
     900: "#1a202c",
   },
 },
});

export default theme;
`,
		},
		antd: {
			'src/styles/globals.css': '@import "antd/dist/reset.css";\n\n/* Custom styles */\n',
		},
	}

	if (cssConfigs[cssFramework]) {
		for (const [fileName, content] of Object.entries(cssConfigs[cssFramework])) {
			const filePath = path.join(projectPath, fileName)
			await fs.ensureDir(path.dirname(filePath))
			await fs.writeFile(filePath, content)
		}
	}
}

async function applyFeatureConfigurations(projectPath, features, framework) {
	for (const feature of features) {
		try {
			switch (feature) {
				case 'linting':
					await applyLintingConfig(projectPath, framework)
					break
				case 'testing':
					await applyTestingConfig(projectPath, framework)
					break
				case 'docker':
					await applyDockerConfig(projectPath, framework)
					break
				case 'github-actions':
					await applyGithubActionsConfig(projectPath, framework)
					break
				case 'docs':
					await applyDocsConfig(projectPath, framework)
					break
				case 'storybook':
					await applyStorybookConfig(projectPath, framework)
					break
				case 'monitoring':
					await applyMonitoringConfig(projectPath, framework)
					break
				case 'hot-reload':
					await applyHotReloadConfig(projectPath, framework)
					break
			}
		} catch (error) {
			console.error(`Error applying feature ${feature}:`, error)
		}
	}
}

async function applyLintingConfig(projectPath, framework) {
	if (framework.tags.includes('javascript') || framework.tags.includes('typescript')) {
		const eslintConfig = {
			'.eslintrc.json': `{
 "env": {
   "browser": true,
   "es2021": true,
   "node": true
 },
 "extends": [
   "eslint:recommended"${
			framework.tags.includes('typescript') ? ',\n    "@typescript-eslint/recommended"' : ''
		}${
				framework.tags.includes('react')
					? ',\n    "plugin:react/recommended",\n    "plugin:react-hooks/recommended"'
					: ''
			}${framework.tags.includes('vue') ? ',\n    "plugin:vue/vue3-essential"' : ''}
 ],
 "parserOptions": {
   "ecmaVersion": 12,
   "sourceType": "module"${
			framework.tags.includes('typescript')
				? ',\n    "parser": "@typescript-eslint/parser"'
				: ''
		}
 },
 "plugins": [${framework.tags.includes('typescript') ? '\n    "@typescript-eslint"' : ''}${
				framework.tags.includes('react') ? ',\n    "react",\n    "react-hooks"' : ''
			}${framework.tags.includes('vue') ? ',\n    "vue"' : ''}
 ],
 "rules": {
   "indent": ["error", 2],
   "linebreak-style": ["error", "unix"],
   "quotes": ["error", "single"],
   "semi": ["error", "always"]
 },
 "settings": {${
		framework.tags.includes('react')
			? '\n    "react": {\n      "version": "detect"\n    }'
			: ''
 }
 }
}
`,
			'.prettierrc': `{
 "semi": true,
 "trailingComma": "es5",
 "singleQuote": true,
 "printWidth": 80,
 "tabWidth": 2,
 "useTabs": false
}
`,
			'.prettierignore': `node_modules/
dist/
build/
coverage/
*.min.js
*.min.css
package-lock.json
yarn.lock
`,
		}

		for (const [fileName, content] of Object.entries(eslintConfig)) {
			await fs.writeFile(path.join(projectPath, fileName), content)
		}
	}

	// Python linting configuration
	if (framework.tags.includes('python')) {
		const pythonLintConfig = {
			'.flake8': `[flake8]
max-line-length = 88
select = C,E,F,W,B,B950
ignore = E203, E501, W503
`,
			'pyproject.toml': `[tool.black]
line-length = 88
target-version = ['py38']

[tool.isort]
profile = "black"
multi_line_output = 3

[tool.mypy]
python_version = "3.8"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
`,
		}

		for (const [fileName, content] of Object.entries(pythonLintConfig)) {
			await fs.writeFile(path.join(projectPath, fileName), content)
		}
	}
}

async function applyTestingConfig(projectPath, framework) {
	// Create test directories and basic test files
	const testDir = path.join(projectPath, 'tests')
	await fs.ensureDir(testDir)

	if (framework.tags.includes('javascript') || framework.tags.includes('typescript')) {
		// Jest configuration
		const jestConfig = {
			'jest.config.js': `module.exports = {
 testEnvironment: 'node',
 collectCoverage: true,
 coverageDirectory: 'coverage',
 coverageReporters: ['text', 'lcov', 'html'],
 testMatch: [
   '**/__tests__/**/*.(js|jsx|ts|tsx)',
   '**/*.(test|spec).(js|jsx|ts|tsx)'
 ],
 moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json'],
 transform: {${
		framework.tags.includes('typescript') ? '\n    "^.+\\.(ts|tsx)$": "ts-jest",' : ''
 }
   "^.+\\.(js|jsx)$": "babel-jest"
 }
};
`,
		}

		for (const [fileName, content] of Object.entries(jestConfig)) {
			await fs.writeFile(path.join(projectPath, fileName), content)
		}

		// Example test file
		const testExtension = framework.tags.includes('typescript') ? 'ts' : 'js'
		await fs.writeFile(
			path.join(testDir, `example.test.${testExtension}`),
			`// Example test file
describe('Example Test Suite', () => {
 test('should pass', () => {
   expect(true).toBe(true);
 });

 test('should handle async operations', async () => {
   const result = await Promise.resolve('success');
   expect(result).toBe('success');
 });
});
`
		)
	} else if (framework.tags.includes('python')) {
		// Python testing setup
		await fs.writeFile(
			path.join(testDir, 'conftest.py'),
			`import pytest
import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
`
		)

		await fs.writeFile(
			path.join(testDir, 'test_example.py'),
			`import pytest

def test_example():
   """Example test function."""
   assert True

def test_addition():
   """Test basic arithmetic."""
   assert 1 + 1 == 2

@pytest.mark.asyncio
async def test_async_function():
   """Test async functionality."""
   result = await async_example()
   assert result == "success"

async def async_example():
   return "success"
`
		)
	}
}

async function applyDockerConfig(projectPath, framework) {
	let dockerfileContent = ''
	let dockerIgnoreContent = `node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.nyc_output
coverage
.docker
dist
build
`

	// Framework-specific Dockerfiles
	if (framework.tags.includes('javascript')) {
		dockerfileContent = `# Multi-stage build for Node.js application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build the application (if build script exists)
RUN npm run build 2>/dev/null || echo "No build script found"

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \\
   adduser -S nextjs -u 1001

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app .

USER nextjs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
 CMD node healthcheck.js

CMD ["npm", "start"]
`
	} else if (framework.tags.includes('python')) {
		dockerfileContent = `# Multi-stage build for Python application
FROM python:3.11-slim AS builder

# Set environment variables
ENV PYTHONUNBUFFERED=1 \\
   PYTHONDONTWRITEBYTECODE=1 \\
   PIP_NO_CACHE_DIR=1 \\
   PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && \\
   apt-get install -y --no-install-recommends build-essential && \\
   rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --user -r requirements.txt

# Production stage
FROM python:3.11-slim AS production

ENV PYTHONUNBUFFERED=1 \\
   PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy dependencies from builder stage
COPY --from=builder /root/.local /home/appuser/.local

# Copy application code
COPY --chown=appuser:appuser . .

# Make sure scripts are executable
RUN chmod +x /home/appuser/.local/bin/*

# Update PATH
ENV PATH=/home/appuser/.local/bin:$PATH

USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
 CMD python healthcheck.py

CMD ["python", "main.py"]
`
		dockerIgnoreContent = `__pycache__
*.pyc
*.pyo
*.pyd
.Python
env
pip-log.txt
pip-delete-this-directory.txt
.tox
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
*.log
.git
.mypy_cache
.pytest_cache
.hypothesis
.venv
venv/
.env
`
	} else if (framework.tags.includes('java')) {
		dockerfileContent = `# Multi-stage build for Java application
FROM maven:3.8.6-openjdk-11-slim AS builder

WORKDIR /app

# Copy pom.xml and download dependencies
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source and build
COPY src ./src
RUN mvn clean package -DskipTests

# Production stage
FROM openjdk:11-jre-slim AS production

WORKDIR /app

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy jar from builder stage
COPY --from=builder --chown=appuser:appuser /app/target/*.jar app.jar

USER appuser

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
 CMD curl -f http://localhost:8080/health || exit 1

CMD ["java", "-jar", "app.jar"]
`
		dockerIgnoreContent = `target/
!.mvn/wrapper/maven-wrapper.jar
!**/src/main/**/target/
!**/src/test/**/target/
.git
.gitignore
README.md
.env
`
	}

	const dockerFiles = {
		Dockerfile: dockerfileContent,
		'.dockerignore': dockerIgnoreContent,
		'docker-compose.yml': `version: '3.8'

services:
 app:
   build:
     context: .
     dockerfile: Dockerfile
   ports:
     - "3000:3000"
   environment:
     - NODE_ENV=production
   volumes:
     - ./logs:/app/logs
   depends_on:
     - db
   networks:
     - app-network

 db:
   image: postgres:15-alpine
   environment:
     POSTGRES_DB: {{PROJECT_NAME}}
     POSTGRES_USER: user
     POSTGRES_PASSWORD: password
   volumes:
     - postgres_data:/var/lib/postgresql/data
   networks:
     - app-network

volumes:
 postgres_data:

networks:
 app-network:
   driver: bridge
`,
	}

	for (const [fileName, content] of Object.entries(dockerFiles)) {
		await fs.writeFile(path.join(projectPath, fileName), content)
	}

	// Create healthcheck file for Node.js
	if (framework.tags.includes('javascript')) {
		await fs.writeFile(
			path.join(projectPath, 'healthcheck.js'),
			`const http = require('http');

const options = {
 hostname: 'localhost',
 port: process.env.PORT || 3000,
 path: '/health',
 method: 'GET',
 timeout: 2000
};

const req = http.request(options, (res) => {
 if (res.statusCode === 200) {
   process.exit(0);
 } else {
   process.exit(1);
 }
});

req.on('error', () => {
 process.exit(1);
});

req.on('timeout', () => {
 req.destroy();
 process.exit(1);
});

req.end();
`
		)
	}
}

async function applyGithubActionsConfig(projectPath, framework) {
	const workflowDir = path.join(projectPath, '.github', 'workflows')
	await fs.ensureDir(workflowDir)

	let ciConfig = ''

	if (framework.tags.includes('javascript')) {
		ciConfig = `name: CI/CD Pipeline

on:
 push:
   branches: [ main, develop ]
 pull_request:
   branches: [ main ]

env:
 NODE_VERSION: '18'

jobs:
 test:
   runs-on: ubuntu-latest
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
   
   - name: Setup Node.js
     uses: actions/setup-node@v4
     with:
       node-version: \${{ env.NODE_VERSION }}
       cache: 'npm'
   
   - name: Install dependencies
     run: npm ci
   
   - name: Run linting
     run: npm run lint
   
   - name: Run tests
     run: npm test -- --coverage
   
   - name: Upload coverage reports
     uses: codecov/codecov-action@v3
     with:
       file: ./coverage/lcov.info
       flags: unittests
       name: codecov-umbrella

 build:
   needs: test
   runs-on: ubuntu-latest
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
   
   - name: Setup Node.js
     uses: actions/setup-node@v4
     with:
       node-version: \${{ env.NODE_VERSION }}
       cache: 'npm'
   
   - name: Install dependencies
     run: npm ci
   
   - name: Build application
     run: npm run build
   
   - name: Upload build artifacts
     uses: actions/upload-artifact@v3
     with:
       name: build-files
       path: dist/

 deploy:
   needs: [test, build]
   runs-on: ubuntu-latest
   if: github.ref == 'refs/heads/main'
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
     
   - name: Deploy to production
     run: |
       echo "Add your deployment script here"
       # Example: Deploy to AWS, Vercel, Netlify, etc.
`
	} else if (framework.tags.includes('python')) {
		ciConfig = `name: CI/CD Pipeline

on:
 push:
   branches: [ main, develop ]
 pull_request:
   branches: [ main ]

env:
 PYTHON_VERSION: '3.11'

jobs:
 test:
   runs-on: ubuntu-latest
   
   services:
     postgres:
       image: postgres:13
       env:
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: test
       options: >-
         --health-cmd pg_isready
         --health-interval 10s
         --health-timeout 5s
         --health-retries 5
       ports:
         - 5432:5432
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
   
   - name: Setup Python
     uses: actions/setup-python@v4
     with:
       python-version: \${{ env.PYTHON_VERSION }}
       cache: 'pip'
   
   - name: Install dependencies
     run: |
       python -m pip install --upgrade pip
       pip install -r requirements.txt
       pip install -r requirements-dev.txt
   
   - name: Run linting
     run: |
       flake8 src/
       black --check src/
       isort --check-only src/
   
   - name: Run type checking
     run: mypy src/
   
   - name: Run tests
     env:
       DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
     run: |
       pytest --cov=src --cov-report=xml
   
   - name: Upload coverage reports
     uses: codecov/codecov-action@v3
     with:
       file: ./coverage.xml
       flags: unittests
       name: codecov-umbrella

 deploy:
   needs: test
   runs-on: ubuntu-latest
   if: github.ref == 'refs/heads/main'
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
     
   - name: Deploy to production
     run: |
       echo "Add your deployment script here"
       # Example: Deploy to AWS, Heroku, Digital Ocean, etc.
`
	} else {
		// Generic CI config
		ciConfig = `name: CI/CD Pipeline

on:
 push:
   branches: [ main, develop ]
 pull_request:
   branches: [ main ]

jobs:
 test:
   runs-on: ubuntu-latest
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
   
   - name: Run tests
     run: |
       echo "Add your test commands here"
   
   - name: Build application
     run: |
       echo "Add your build commands here"

 deploy:
   needs: test
   runs-on: ubuntu-latest
   if: github.ref == 'refs/heads/main'
   
   steps:
   - name: Checkout code
     uses: actions/checkout@v4
     
   - name: Deploy to production
     run: |
       echo "Add your deployment script here"
`
	}

	await fs.writeFile(path.join(workflowDir, 'ci.yml'), ciConfig)
}

async function applyDocsConfig(projectPath, framework) {
	const docsDir = path.join(projectPath, 'docs')
	await fs.ensureDir(docsDir)

	const readmeContent = `# {{PROJECT_NAME}} Documentation

## Overview

This is the documentation for {{PROJECT_NAME}}, a ${framework.name} project.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Usage](#usage)
5. [API Reference](#api-reference)
6. [Contributing](#contributing)
7. [License](#license)

## Getting Started

### Prerequisites

- Node.js (version 18 or higher)
- npm or yarn package manager

### Quick Start

\`\`\`bash
# Clone the repository
git clone <repository-url>

# Navigate to project directory
cd {{PROJECT_NAME}}

# Install dependencies
npm install

# Start development server
npm run dev
\`\`\`

## Installation

Detailed installation instructions go here.

## Configuration

Configuration options and environment variables.

### Environment Variables

\`\`\`env
NODE_ENV=development
PORT=3000
DATABASE_URL=your-database-url
\`\`\`

## Usage

Examples of how to use the application.

## API Reference

API documentation will be added here.

## Contributing

Guidelines for contributing to the project.

## License

This project is licensed under the MIT License.
`

	await fs.writeFile(path.join(docsDir, 'README.md'), readmeContent)

	// Create additional documentation files
	const docFiles = {
		'installation.md': '# Installation Guide\n\nDetailed installation instructions...\n',
		'configuration.md': '# Configuration\n\nConfiguration options and settings...\n',
		'usage.md': '# Usage\n\nHow to use the application...\n',
		'api.md': '# API Reference\n\nAPI documentation...\n',
		'contributing.md': '# Contributing\n\nGuidelines for contributors...\n',
	}

	for (const [fileName, content] of Object.entries(docFiles)) {
		await fs.writeFile(path.join(docsDir, fileName), content)
	}
}

async function applyStorybookConfig(projectPath, framework) {
	if (framework.tags.includes('frontend')) {
		const storybookDir = path.join(projectPath, '.storybook')
		await fs.ensureDir(storybookDir)

		const mainConfig = `module.exports = {
 stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
 addons: [
   '@storybook/addon-essentials',
   '@storybook/addon-interactions',
   '@storybook/addon-a11y',
 ],
 framework: {
   name: '@storybook/react-webpack5',
   options: {},
 },
 docs: {
   autodocs: 'tag',
 },
};
`

		const previewConfig = `export const parameters = {
 actions: { argTypesRegex: '^on[A-Z].*' },
 controls: {
   matchers: {
     color: /(background|color)$/i,
     date: /Date$/,
   },
 },
};
`

		await fs.writeFile(path.join(storybookDir, 'main.js'), mainConfig)
		await fs.writeFile(path.join(storybookDir, 'preview.js'), previewConfig)
	}
}

async function applyMonitoringConfig(projectPath, framework) {
	// Basic monitoring setup with health check endpoint
	const monitoringFiles = {
		'monitoring/health.js': `const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
 const healthcheck = {
   uptime: process.uptime(),
   message: 'OK',
   timestamp: Date.now()
 };
 
 try {
   res.status(200).send(healthcheck);
 } catch (error) {
   healthcheck.message = error;
   res.status(503).send();
 }
});

module.exports = router;
`,
		'monitoring/metrics.js': `// Basic metrics collection
const metrics = {
 requests: 0,
 errors: 0,
 uptime: () => process.uptime()
};

const incrementRequests = () => {
 metrics.requests++;
};

const incrementErrors = () => {
 metrics.errors++;
};

const getMetrics = () => {
 return {
   ...metrics,
   uptime: metrics.uptime()
 };
};

module.exports = {
 incrementRequests,
 incrementErrors,
 getMetrics
};
`,
	}

	for (const [filePath, content] of Object.entries(monitoringFiles)) {
		const fullPath = path.join(projectPath, filePath)
		await fs.ensureDir(path.dirname(fullPath))
		await fs.writeFile(fullPath, content)
	}
}

async function applyHotReloadConfig(projectPath, framework) {
	if (framework.tags.includes('javascript')) {
		// Add nodemon configuration for Node.js projects
		const nodemonConfig = {
			'nodemon.json': `{
 "watch": ["src"],
 "ext": "js,ts,json",
 "ignore": ["src/**/*.test.js", "node_modules"],
 "exec": "node src/index.js",
 "env": {
   "NODE_ENV": "development"
 }
}
`,
		}

		for (const [fileName, content] of Object.entries(nodemonConfig)) {
			await fs.writeFile(path.join(projectPath, fileName), content)
		}
	}
}

async function runPostCreationScripts(projectPath, framework, additionalConfig) {
	// Run any post-creation scripts if needed
	try {
		// Initialize git repository
		await execAsync('git init', { cwd: projectPath })
		await execAsync('git add .', { cwd: projectPath })
		await execAsync('git commit -m "Initial commit from KickStart Hub"', { cwd: projectPath })

		// Create initial branch structure
		await execAsync('git branch develop', { cwd: projectPath }).catch(() => {
			// Branch creation might fail, ignore
		})

		console.log('Git repository initialized successfully')
	} catch (error) {
		// Git initialization is optional, so don't fail the entire process
		console.log('Git initialization skipped:', error.message)
	}

	// Create .gitignore if it doesn't exist
	try {
		const gitignorePath = path.join(projectPath, '.gitignore')
		if (!(await fs.pathExists(gitignorePath))) {
			await createGitignoreFile(projectPath, framework)
		}
	} catch (error) {
		console.error('Error creating .gitignore:', error)
	}

	// Create environment file template
	try {
		const envPath = path.join(projectPath, '.env.example')
		if (!(await fs.pathExists(envPath))) {
			await createEnvTemplate(projectPath, framework, additionalConfig)
		}
	} catch (error) {
		console.error('Error creating .env.example:', error)
	}
}

async function createGitignoreFile(projectPath, framework) {
	let gitignoreContent = `# Dependencies
node_modules/
*/node_modules/

# Production builds
dist/
build/
out/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
lerna-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/

# Editor directories and files
.vscode/
.idea/
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
`

	// Add language-specific ignores
	if (framework.tags.includes('python')) {
		gitignoreContent += `
# Python specific
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
MANIFEST

# PyInstaller
*.manifest
*.spec

# Unit test / coverage reports
htmlcov/
.tox/
.nox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
.hypothesis/
.pytest_cache/

# Virtual environments
.env
.venv
env/
venv/
ENV/
env.bak/
venv.bak/

# Jupyter Notebook
.ipynb_checkpoints

# IPython
profile_default/
ipython_config.py

# pyenv
.python-version

# celery beat schedule file
celerybeat-schedule

# SageMath parsed files
*.sage.py

# Spyder project settings
.spyderproject
.spyproject

# Rope project settings
.ropeproject

# mkdocs documentation
/site

# mypy
.mypy_cache/
.dmypy.json
dmypy.json
`
	}

	if (framework.tags.includes('java')) {
		gitignoreContent += `
# Java specific
*.class
*.log
*.ctxt
.mtj.tmp/
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Package Files
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml
buildNumber.properties
.mvn/timing.properties
.mvn/wrapper/maven-wrapper.jar

# Gradle
.gradle
build/
!gradle/wrapper/gradle-wrapper.jar
!**/src/main/**/build/
!**/src/test/**/build/

# IntelliJ IDEA
.idea/
*.iws
*.iml
*.ipr
out/

# Eclipse
.apt_generated
.classpath
.factorypath
.project
.settings
.springBeans
.sts4-cache
bin/
!**/src/main/**/bin/
!**/src/test/**/bin/

# NetBeans
/nbproject/private/
/nbbuild/
/dist/
/nbdist/
/.nb-gradle/

# VS Code
.vscode/
`
	}

	if (framework.tags.includes('csharp')) {
		gitignoreContent += `
# .NET specific
bin/
obj/
out/

# User-specific files
*.rsuser
*.suo
*.user
*.userosscache
*.sln.docstates

# User-specific files (MonoDevelop/Xamarin Studio)
*.userprefs

# Mono auto generated files
mono_crash.*

# Build results
[Dd]ebug/
[Dd]ebugPublic/
[Rr]elease/
[Rr]eleases/
x64/
x86/
[Ww][Ii][Nn]32/
[Aa][Rr][Mm]/
[Aa][Rr][Mm]64/
bld/
[Bb]in/
[Oo]bj/
[Ll]og/
[Ll]ogs/

# Visual Studio 2015/2017 cache/options directory
.vs/

# MSTest test Results
[Tt]est[Rr]esult*/
[Bb]uild[Ll]og.*

# NUnit
*.VisualState.xml
TestResult.xml
nunit-*.xml

# .NET Core
project.lock.json
project.fragment.lock.json
artifacts/

# Packages
*.nupkg
*.snupkg
**/[Pp]ackages/*
!**/[Pp]ackages/build/
*.nuget.props
*.nuget.targets

# ASP.NET Scaffolding
ScaffoldingReadMe.txt
`
	}

	await fs.writeFile(path.join(projectPath, '.gitignore'), gitignoreContent)
}

async function createEnvTemplate(projectPath, framework, additionalConfig) {
	let envContent = `# Environment Configuration
NODE_ENV=development
PORT=3000

# Application Settings
APP_NAME={{PROJECT_NAME}}
APP_VERSION=1.0.0

`

	// Add database configuration
	if (additionalConfig.database && additionalConfig.database !== 'none') {
		switch (additionalConfig.database) {
			case 'postgresql':
				envContent += `# PostgreSQL Database
DATABASE_URL=postgresql://username:password@localhost:5432/{{PROJECT_NAME}}
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB={{PROJECT_NAME}}
POSTGRES_USER=username
POSTGRES_PASSWORD=password

`
				break
			case 'mongodb':
				envContent += `# MongoDB Database
MONGODB_URI=mongodb://localhost:27017/{{PROJECT_NAME}}
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB={{PROJECT_NAME}}

`
				break
			case 'mysql':
				envContent += `# MySQL Database
DATABASE_URL=mysql://username:password@localhost:3306/{{PROJECT_NAME}}
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE={{PROJECT_NAME}}
MYSQL_USER=username
MYSQL_PASSWORD=password

`
				break
			case 'redis':
				envContent += `# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

`
				break
			case 'sqlite':
				envContent += `# SQLite Database
DATABASE_URL=sqlite:./{{PROJECT_NAME}}.db

`
				break
		}
	}

	// Add authentication configuration
	if (additionalConfig.authentication && additionalConfig.authentication !== 'none') {
		switch (additionalConfig.authentication) {
			case 'jwt':
				envContent += `# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

`
				break
			case 'oauth':
				envContent += `# OAuth Configuration
OAUTH_CLIENT_ID=your-oauth-client-id
OAUTH_CLIENT_SECRET=your-oauth-client-secret
OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback

`
				break
			case 'auth0':
				envContent += `# Auth0 Configuration
AUTH0_DOMAIN=your-auth0-domain.auth0.com
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_CALLBACK_URL=http://localhost:3000/callback

`
				break
		}
	}

	// Add framework-specific environment variables
	if (framework.tags.includes('frontend')) {
		envContent += `# Frontend Configuration
REACT_APP_API_URL=http://localhost:3001
REACT_APP_ENVIRONMENT=development

`
	}

	if (framework.tags.includes('backend')) {
		envContent += `# Backend Configuration
API_PREFIX=/api/v1
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

`
	}

	// Add monitoring and logging
	envContent += `# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Security
SESSION_SECRET=your-session-secret-change-this-in-production
BCRYPT_ROUNDS=12

# Email Configuration (if needed)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-email-password

# External Services
# AWS_ACCESS_KEY_ID=your-aws-access-key
# AWS_SECRET_ACCESS_KEY=your-aws-secret-key
# AWS_REGION=us-east-1

# Third-party APIs
# STRIPE_PUBLIC_KEY=pk_test_your-stripe-public-key
# STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
`

	await fs.writeFile(path.join(projectPath, '.env.example'), envContent)
}

async function handlePostCreationAction(action, projectPath, framework, additionalConfig) {
	switch (action) {
		case 'Open Project':
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath))
			break

		case 'Open in New Window':
			await vscode.commands.executeCommand(
				'vscode.openFolder',
				vscode.Uri.file(projectPath),
				true
			)
			break

		case 'Show in Explorer':
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(projectPath))
			break

		case 'Install Dependencies':
			await installDependencies(
				projectPath,
				additionalConfig.packageManager || 'npm',
				framework
			)
			break
	}
}

async function installDependencies(projectPath, packageManager, framework) {
	const terminal = vscode.window.createTerminal({
		name: 'KickStart Hub - Install Dependencies',
		cwd: projectPath,
	})

	terminal.show()

	const installCommands = {
		npm: 'npm install',
		yarn: 'yarn install',
		pnpm: 'pnpm install',
		bun: 'bun install',
	}

	const installCommand = installCommands[packageManager] || 'npm install'

	// Send installation command
	terminal.sendText(installCommand)

	// If it's a Python project, also install pip dependencies
	if (framework.tags.includes('python')) {
		terminal.sendText('pip install -r requirements.txt')
	}

	// If it's a Java project with Maven, install dependencies
	if (
		framework.tags.includes('java') &&
		(await fs.pathExists(path.join(projectPath, 'pom.xml')))
	) {
		terminal.sendText('mvn clean install')
	}

	// Show completion message
	vscode.window.showInformationMessage(
		`Installing dependencies with ${packageManager}... Check terminal for progress.`
	)

	// Optionally start the development server after installation
	const shouldStartDev = await vscode.window.showInformationMessage(
		'Dependencies installation started. Would you like to start the development server after installation?',
		'Yes',
		'No'
	)

	if (shouldStartDev === 'Yes') {
		// Wait a moment for installation to complete (this is just a UX enhancement)
		setTimeout(() => {
			const devCommands = {
				npm: 'npm run dev',
				yarn: 'yarn dev',
				pnpm: 'pnpm dev',
				bun: 'bun dev',
			}

			const devCommand = devCommands[packageManager] || 'npm run dev'

			// Check if dev script exists in package.json before running
			if (framework.tags.includes('javascript')) {
				terminal.sendText(`echo "Starting development server..." && ${devCommand}`)
			} else if (framework.tags.includes('python')) {
				terminal.sendText('echo "Starting development server..." && python main.py')
			}
		}, 3000) // 3 second delay
	}
}

async function downloadFile(url) {
	return new Promise((resolve, reject) => {
		const chunks = []

		https
			.get(url, (response) => {
				if (response.statusCode === 302 || response.statusCode === 301) {
					// Handle redirect
					return downloadFile(response.headers.location).then(resolve).catch(reject)
				}

				if (response.statusCode !== 200) {
					reject(
						new Error(`HTTP ${response.statusCode}: ${response.statusMessage} for URL: ${url}`)
					)
					return
				}

				response.on('data', (chunk) => chunks.push(chunk))
				response.on('end', () => resolve(Buffer.concat(chunks).toString()))
				response.on('error', reject)
			})
			.on('error', reject)
	})
}

async function downloadJson(url) {
	try {
		const data = await downloadFile(url)
		return JSON.parse(data)
	} catch (error) {
		if (error.message.includes('404')) {
			throw new Error(`Resource not found: ${url}`)
		}
		throw new Error(`Failed to download JSON from ${url}: ${error.message}`)
	}
}

function getExtensionPath() {
	const extension = vscode.extensions.getExtension('Fahad-Ismail.kickstarthub')
	if (!extension) {
		vscode.window.showErrorMessage('Extension not found. Please restart VS Code.')
		return null
	}
	return extension.extensionPath
}

module.exports = { createProject }
