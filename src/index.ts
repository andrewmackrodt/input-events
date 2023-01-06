import { clearTimeout, setTimeout } from 'timers'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'

const timeoutMillis = 10000

let backlightState = 1
let lastEventTime = 0
let child: ChildProcessWithoutNullStreams | null = null
let timeoutId: NodeJS.Timeout | null = null

function exitHandler() {
    if (child !== null) {
        child.kill()
        child = null
    }

    if (timeoutId !== null ) {
        clearTimeout(timeoutId)
        timeoutId = null
    }

    process.exit()
}

function disableBacklightAfterInactivity(delay: number) {
    timeoutId = setTimeout(() => {
        const elapsedSinceLastEvent = Date.now() - lastEventTime

        if (elapsedSinceLastEvent >= timeoutMillis) {
            if (timeoutId !== null) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            console.log('turning off backlight')
            toggleBacklight()
            backlightState = 0
        } else {
            disableBacklightAfterInactivity(timeoutMillis - elapsedSinceLastEvent)
        }
    }, delay)
}

function onEvent(buffer: Buffer) {
    lastEventTime = Date.now()

    if (backlightState === 0) {
        console.log('turning on backlight')
        toggleBacklight()
        backlightState = 1
        disableBacklightAfterInactivity(timeoutMillis)
    }
}

interface ConsoleResult {
    stdout?: string
    stderr?: string
    exitCode: number
}


async function exec(command: string, args: string[] = []): Promise<ConsoleResult> {
    const child = spawn(command, args)
    let resolve: (value: ConsoleResult) => void
    let reject: (error: Error) => void

    const promise = new Promise<ConsoleResult>((_resolve, _reject) => {
        resolve = _resolve
        reject = _reject
    })

    const res: Partial<ConsoleResult> = {}

    child.on('error', error => {
        try {
            child.kill('SIGKILL')
        } catch (e) {
            console.error(e)
        }
        reject(error)
    })

    child.stdout.on('data', (data: Buffer) => {
        if (typeof res.stdout === 'undefined') {
            res.stdout = ''
        }
        res.stdout += data.toString().replace(/\n$/, '')
    })

    child.stderr.on('data', (data: Buffer) => {
        if (typeof res.stderr === 'undefined') {
            res.stderr = ''
        }
        res.stderr += data.toString().replace(/\n$/, '')
    })

    child.on('exit', code => {
        console.log(`${command} exited with code ${code}`)
        res.exitCode = code ?? 0
        resolve(res as ConsoleResult)
    })

    return promise
}


function spawnLibInputProcess() {
    child = spawn('stdbuf', ['-oL', '-eL', 'libinput', 'debug-events'], { detached: true })

    child.on('error', error => {
        console.log('error: ' + error)
    })

    child.stdout.on('data', data => {
        onEvent(data)
    })

    child.stderr.on('data', data => {
        console.log('stderr: ' + data)
    })

    child.on('exit', code => {
        console.log('libinput exited with code ' + code)
    })
}

function toggleBacklight() {
    return exec('gdbus', ['call', '--session',
        '--dest', 'org.gnome.SettingsDaemon.Power',
        '--object-path', '/org/gnome/SettingsDaemon/Power',
        '--method', 'org.gnome.SettingsDaemon.Power.Keyboard.Toggle',
    ])
}

disableBacklightAfterInactivity(timeoutMillis)
spawnLibInputProcess()

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGQUIT']) {
    process.on(signal, exitHandler)
}
