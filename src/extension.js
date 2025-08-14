// const vscode = require('vscode')
// const { createProject } = require('./commands/createProject')

// function activate(context) {
// 	let disposable = vscode.commands.registerCommand('kickstarthub.createProject', createProject)
// 	context.subscriptions.push(disposable)
// }

// function deactivate() {}

// module.exports = {
// 	activate,
// 	deactivate,
// }

const vscode = require('vscode')
const { createProject } = require('./commands/createProject')
// const { listTemplates } = require('./commands/listTemplates')
// const { refreshTemplates } = require('./commands/refreshTemplates')
// const { openTemplate } = require('./commands/openTemplate')

function activate(context) {
	// Register all commands
	const commands = [
		vscode.commands.registerCommand('kickstarthub.createProject', createProject),
		vscode.commands.registerCommand('kickstarthub.listTemplates', createProject),
		vscode.commands.registerCommand('kickstarthub.refreshTemplates', createProject),
		vscode.commands.registerCommand('kickstarthub.openTemplate', createProject),
	]

	commands.forEach((command) => context.subscriptions.push(command))

	// Show welcome message on first install
	showWelcomeMessage(context)
}

async function showWelcomeMessage(context) {
	const hasShownWelcome = context.globalState.get('kickstarthub.hasShownWelcome', false)

	if (!hasShownWelcome) {
		const action = await vscode.window.showInformationMessage(
			'🚀 Welcome to KickStart Hub! Ready to create your first project?',
			'Create Project'
			// 'View Templates'
		)

		if (action === 'Create Project') {
			vscode.commands.executeCommand('kickstarthub.createProject')
		} else if (action === 'View Templates') {
			vscode.commands.executeCommand('kickstarthub.listTemplates')
		}

		context.globalState.update('kickstarthub.hasShownWelcome', true)
	}
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
}
