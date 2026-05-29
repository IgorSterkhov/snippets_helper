package com.snippetshelper

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
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
    promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactContext))
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
    if (!SpeechRecognizer.isRecognitionAvailable(reactContext)) {
      promise.reject("speech_unavailable", "Speech recognition is not available on this device")
      return
    }

    pendingPromise = promise
    reactContext.runOnUiQueueThread {
      val nextRecognizer = SpeechRecognizer.createSpeechRecognizer(reactContext)
      recognizer = nextRecognizer
      nextRecognizer.setRecognitionListener(object : RecognitionListener {
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
      })
      nextRecognizer.startListening(recognitionIntent(locale))
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    reactContext.runOnUiQueueThread {
      val activeRecognizer = recognizer
      if (activeRecognizer == null) {
        promise.resolve(false)
      } else {
        activeRecognizer.stopListening()
        promise.resolve(true)
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

  private fun cleanup() {
    recognizer?.destroy()
    recognizer = null
    pendingPromise = null
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
