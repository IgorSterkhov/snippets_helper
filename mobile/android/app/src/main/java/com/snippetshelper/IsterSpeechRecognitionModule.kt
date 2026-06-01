package com.snippetshelper

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.util.Locale

@ReactModule(name = IsterSpeechRecognitionModule.NAME)
class IsterSpeechRecognitionModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private var recognizer: SpeechRecognizer? = null
  private var pendingPromise: Promise? = null

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    try {
      promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactContext))
    } catch (e: Throwable) {
      promise.reject(
        "speech_availability_failed",
        "Speech recognition availability check failed: ${readableThrowable(e)}",
        e,
      )
    }
  }

  @ReactMethod
  fun start(locale: String?, promise: Promise) {
    if (pendingPromise != null) {
      promise.reject("speech_busy", "Speech recognition is already running")
      return
    }
    if (reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("speech_permission_denied", "Microphone permission was not granted")
      return
    }
    val available = try {
      SpeechRecognizer.isRecognitionAvailable(reactContext)
    } catch (e: Throwable) {
      promise.reject(
        "speech_availability_failed",
        "Speech recognition availability check failed: ${readableThrowable(e)}",
        e,
      )
      return
    }
    if (!available) {
      promise.reject("speech_unavailable", "Speech recognition is not available on this device")
      return
    }

    pendingPromise = promise
    reactContext.runOnUiQueueThread {
      val candidates = recognitionServiceCandidates()
      val attempts = if (candidates.isEmpty()) listOf<ComponentName?>(null) else candidates + null
      val tried = mutableListOf<String>()
      var lastError: Throwable? = null

      for (componentName in attempts) {
        var candidateRecognizer: SpeechRecognizer? = null
        try {
          tried.add(componentName?.flattenToShortString() ?: "system default")
          val nextRecognizer = if (componentName == null) {
            SpeechRecognizer.createSpeechRecognizer(reactContext)
          } else {
            SpeechRecognizer.createSpeechRecognizer(reactContext, componentName)
          }
          candidateRecognizer = nextRecognizer
          recognizer = nextRecognizer
          nextRecognizer.setRecognitionListener(createRecognitionListener())
          nextRecognizer.startListening(recognitionIntent(locale))
          return@runOnUiQueueThread
        } catch (e: Throwable) {
          lastError = e
          try {
            candidateRecognizer?.destroy()
          } catch (_: Throwable) {
            // Continue trying other recognizers even if a failed candidate cannot be destroyed.
          }
          recognizer = null
        }
      }

      val activePromise = pendingPromise
      cleanup()
      activePromise?.reject(
        "speech_start_failed",
        "Speech recognition failed to start. Tried ${tried.joinToString(", ")}. Last error: ${readableNullableThrowable(lastError)}",
        lastError,
      )
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    reactContext.runOnUiQueueThread {
      try {
        val activeRecognizer = recognizer
        if (activeRecognizer == null) {
          promise.resolve(false)
        } else {
          activeRecognizer.stopListening()
          promise.resolve(true)
        }
      } catch (e: Throwable) {
        cleanup()
        promise.reject(
          "speech_stop_failed",
          "Speech recognition failed to stop: ${readableThrowable(e)}",
          e,
        )
      }
    }
  }

  override fun invalidate() {
    cleanup()
    super.invalidate()
  }

  private fun recognitionIntent(locale: String?): Intent {
    val language = locale?.takeIf { it.isNotBlank() } ?: Locale.getDefault().toLanguageTag()
    return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
  }

  private fun createRecognitionListener(): RecognitionListener {
    return object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) = Unit
      override fun onBeginningOfSpeech() = Unit
      override fun onRmsChanged(rmsdB: Float) = Unit
      override fun onBufferReceived(buffer: ByteArray?) = Unit
      override fun onEndOfSpeech() = Unit
      override fun onPartialResults(partialResults: Bundle?) = Unit
      override fun onEvent(eventType: Int, params: Bundle?) = Unit

      override fun onError(error: Int) {
        val activePromise = pendingPromise
        cleanup()
        activePromise?.reject("speech_error", readableSpeechError(error))
      }

      override fun onResults(results: Bundle?) {
        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        val text = matches?.firstOrNull().orEmpty()
        val activePromise = pendingPromise
        cleanup()
        if (text.isBlank()) {
          activePromise?.reject("speech_empty", "No speech text recognized")
        } else {
          activePromise?.resolve(text)
        }
      }
    }
  }

  private fun recognitionServiceCandidates(): List<ComponentName> {
    val services = try {
      reactContext.packageManager.queryIntentServices(
        Intent(RecognitionService.SERVICE_INTERFACE),
        PackageManager.MATCH_ALL,
      )
    } catch (_: Throwable) {
      emptyList()
    }

    return services.mapNotNull { resolveInfo ->
      val serviceInfo = resolveInfo.serviceInfo ?: return@mapNotNull null
      if (!serviceInfo.exported) return@mapNotNull null
      ComponentName(serviceInfo.packageName, serviceInfo.name)
    }
      .distinctBy { it.flattenToShortString() }
      .sortedWith(compareBy<ComponentName> { recognitionServicePriority(it) }
        .thenBy { it.packageName }
        .thenBy { it.className })
  }

  private fun recognitionServicePriority(componentName: ComponentName): Int {
    return when (componentName.packageName) {
      "com.google.android.googlequicksearchbox" -> 0
      "com.google.android.as" -> 1
      else -> 10
    }
  }

  private fun cleanup() {
    try {
      recognizer?.destroy()
    } catch (_: Throwable) {
      // Cleanup must never crash the app after a speech recognizer failure.
    }
    recognizer = null
    pendingPromise = null
  }

  private fun readableThrowable(e: Throwable): String {
    val detail = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
    return "${e.javaClass.simpleName}: $detail"
  }

  private fun readableNullableThrowable(e: Throwable?): String {
    return e?.let { readableThrowable(it) } ?: "unknown error"
  }

  private fun readableSpeechError(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
    SpeechRecognizer.ERROR_CLIENT -> "Speech recognition client error"
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission was not granted"
    SpeechRecognizer.ERROR_NETWORK -> "Speech recognition network error"
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout"
    SpeechRecognizer.ERROR_NO_MATCH -> "No speech text recognized"
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognition is already running"
    SpeechRecognizer.ERROR_SERVER -> "Speech recognition server error"
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was detected"
    else -> "Speech recognition failed with error code $error"
  }

  companion object {
    const val NAME = "IsterSpeechRecognition"
  }
}
