import React from "react";
import ReactDOM from "react-dom/client";
import ClientProvider from "./ClientProvider";
import App from "./App";
import { LS_PREFIX, PWA, CACHE_NAME } from "./utils";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
	<ClientProvider>
		<App />
	</ClientProvider>
);

const installDiv = document.getElementById('installContainer');
const installBtn = document.getElementById('installBtn');
const cancelBtn = document.getElementById('cancelBtn');
const iosInstallDiv = document.getElementById('iosInstallContainer');
const closeBtn = document.getElementById('closeBtn');

let isDownloadDeclined = true;

const isIos = () => {
	const userAgent = window.navigator.userAgent.toLowerCase();
	return /iphone|ipad|ipod/.test( userAgent );
}
// Detects if device is in standalone mode
const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

// Checks if should display install popup notification:
if (isIos() && !isInStandaloneMode()) {
	//show install prompt
	isDownloadDeclined = localStorage.getItem(LS_PREFIX + 'declineAppDownload');
	if (!isDownloadDeclined) {
		// Remove the 'hidden' class from the install button container.
		iosInstallDiv.classList.toggle('hidden', false);
	}
} else {
	console.log("non ios device");
}

//set app version - this is for testing purposes to easily see on download prompt what current app version is
document.getElementById('appVersion').textContent = CACHE_NAME;
document.getElementById('iosAppVersion').textContent = CACHE_NAME;


window.addEventListener('beforeinstallprompt', (event) => {
	// Prevent the mini-infobar from appearing on mobile.
	event.preventDefault();
	console.log('beforeinstallprompt', event);
	isDownloadDeclined = localStorage.getItem(LS_PREFIX + 'declineAppDownload');
	if (!isDownloadDeclined) {
		// Stash the event so it can be triggered later.
		window.deferredPrompt = event;
		
		// Remove the 'hidden' class from the install button container.
		installDiv.classList.toggle('hidden', false);
	}
});

window.addEventListener('appinstalled', (event) => {
	console.log('appinstalled, clear deferredPrompt', event);
	// Clear the deferredPrompt so it can be garbage collected
	window.deferredPrompt = null;
	installDiv.classList.toggle('hidden', false);
});

installBtn.addEventListener('click', async () => {
	console.log('installBtn-clicked');
	const promptEvent = window.deferredPrompt;
	if (!promptEvent) {
		alert("Install prompt not available. Is app already installed?");
		// The deferred prompt isn't available.
		window.deferredPrompt = null;
		return;
	}
	// Show the install prompt.
	promptEvent.prompt();
	// Log the result
	const result = await promptEvent.userChoice;
	console.log('userChoice', result);
	// Reset the deferred prompt variable, since
	// prompt() can only be called once.
	window.deferredPrompt = null;
	// Hide the install button.
	installDiv.classList.toggle('hidden', true);
	installDiv.style.display = 'none'
});

cancelBtn.addEventListener('click', async () => {
	console.log('cancelBtn-clicked, set local var');
	installDiv.classList.toggle('hidden', true);
	//when user declines app download, set localStorage var which will be cleared out upon logout
	localStorage.setItem(LS_PREFIX + 'declineAppDownload', true);
});

//click event listener for ios prompt button
closeBtn.addEventListener('click', async () => {
	console.log('closeBtn-clicked, set local var');
	iosInstallDiv.classList.toggle('hidden', true);
	//when user declines app download, set localStorage var which will be cleared out upon logout
	localStorage.setItem(LS_PREFIX + 'declineAppDownload', true);
});


if ("serviceWorker" in navigator) {
	if (PWA) {
		//vars can be passed to sw.js via search params
		window.addEventListener("load", function() {
			navigator.serviceWorker
				.register("/sw.js?pwa="+PWA+"&cache_name="+CACHE_NAME)
				.then((registration) => {
					console.log("[Service worker] Registration", registration);

					if (!('Notification' in window)) {
						console.log("[Service worker] Notifications not supported");
						return false;
					}

					if (Notification.permission !== 'granted') {
						console.log("[Service worker] Notifications not allowed");
						return false;
					}
					
					return registration.pushManager.getSubscription()
						.then(async (subscription) => {
							//if subscription was found, return it and move on
							if (subscription) {
								console.log("[Service worker] Got registration subscription", subscription);
								return subscription;
							}
							
							// This will be called only once when the service worker is installed for first time.
							try {
								//if subscription not found, get the server's public key
								const key = await fetch('./publickey');
								const vapidPublicKey = await key.text();
								console.log("[Service worker] Got vapid key", vapidPublicKey);
								const applicationServerKey = urlB64ToUint8Array(vapidPublicKey);

								//subscribe the user to push notification api
								const options = { applicationServerKey, userVisibleOnly: true };
								await registration.pushManager.subscribe(options);
							} catch (err) {
								console.log("[Service worker] Registration subscription error", err);
							}
						});
				})
				.then(async (subscription) => {
					//subscription part from above 'await registration.pushManager.subscribe()'
					if (subscription) {	//subscription can be false if notification are not supported or granted
						console.log("[Service Worker] Registering subscription to push server", subscription);

						//make SERVER_URL localhost IP address so remote device can connect
						const SERVER_URL = 'http://192.168.1.189:4000/register';
						//post the user subscription to the push server db
						const response = await fetch(SERVER_URL, {
							method: "post",
							headers: {
								"Content-Type": "application/json"
							},
							body: JSON.stringify(subscription)
						});
						console.log("[Service worker] Registering subscription response", response);
						return response;
					}
				})
				.catch(err => console.log("[Service Worker] Not registered", err))
		});
	} else {
		console.log("****************************************");
		console.log("********** NOT RUNNING AS PWA **********");
		console.log("********** DELETING "+CACHE_NAME+" CACHE ***********");
		console.log("****************************************");

		//delete all localStorage items prefixed with 'PWA_nowPlaying_'
		Object.keys(localStorage).forEach(function(key){
			if (key.startsWith('PWA_nowPlaying_') && !key.endsWith('authUser') && !key.endsWith('userHash')) {
				localStorage.removeItem(key);
			}
		});
		navigator.serviceWorker.getRegistrations().then(regs => {
			regs.forEach(reg => {
				console.log("[Service Worker] unregistering", reg);
				reg.unregister();	
			});
		}).catch(function(err) {
			console.log("[Service Worker] unregistration failed: ", err);
		});
	}
} else {
	console.log("Service worker not available in browser. Connection must be over https.");
}

window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

function updateOnlineStatus(event) {
	var condition = navigator.onLine ? "online" : "offline";
	document.body.className = condition;
}

// urlB64ToUint8Array is a magic function that will encode the base64 public key
// to Array buffer which is needed by the subscription option
const urlB64ToUint8Array = base64String => {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding)
		.replace(/\-/g, "+")
		.replace(/_/g, "/");
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
};

function badgeSupport(version) {
	document.getElementById('badgingVersion').value = version;
}

// Check if the API is supported.
if ('setExperimentalAppBadge' in navigator) {
	badgeSupport('v2')
}

// Check if the previous API surface is supported.
if ('ExperimentalBadge' in window) {
	badgeSupport('v1');
}

// Check if the previous API surface is supported.
if ('setAppBadge' in navigator) {
	badgeSupport('v3');
}

