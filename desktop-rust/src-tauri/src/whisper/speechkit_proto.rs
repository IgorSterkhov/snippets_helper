#[derive(Clone, PartialEq, ::prost::Message)]
pub struct TextNormalizationOptions {
    #[prost(int32, tag = "1")]
    pub text_normalization: i32,
    #[prost(bool, tag = "2")]
    pub profanity_filter: bool,
    #[prost(bool, tag = "3")]
    pub literature_text: bool,
    #[prost(int32, tag = "4")]
    pub phone_formatting_mode: i32,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RawAudio {
    #[prost(int32, tag = "1")]
    pub audio_encoding: i32,
    #[prost(int64, tag = "2")]
    pub sample_rate_hertz: i64,
    #[prost(int64, tag = "3")]
    pub audio_channel_count: i64,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AudioFormatOptions {
    #[prost(oneof = "audio_format_options::AudioFormat", tags = "1")]
    pub audio_format: Option<audio_format_options::AudioFormat>,
}

pub mod audio_format_options {
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum AudioFormat {
        #[prost(message, tag = "1")]
        RawAudio(super::RawAudio),
    }
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct LanguageRestrictionOptions {
    #[prost(int32, tag = "1")]
    pub restriction_type: i32,
    #[prost(string, repeated, tag = "2")]
    pub language_code: Vec<String>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct RecognitionModelOptions {
    #[prost(string, tag = "1")]
    pub model: String,
    #[prost(message, optional, tag = "2")]
    pub audio_format: Option<AudioFormatOptions>,
    #[prost(message, optional, tag = "3")]
    pub text_normalization: Option<TextNormalizationOptions>,
    #[prost(message, optional, tag = "4")]
    pub language_restriction: Option<LanguageRestrictionOptions>,
    #[prost(int32, tag = "5")]
    pub audio_processing_type: i32,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct StreamingOptions {
    #[prost(message, optional, tag = "1")]
    pub recognition_model: Option<RecognitionModelOptions>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AudioChunk {
    #[prost(bytes = "vec", tag = "1")]
    pub data: Vec<u8>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct StreamingRequest {
    #[prost(oneof = "streaming_request::Event", tags = "1, 2")]
    pub event: Option<streaming_request::Event>,
}

pub mod streaming_request {
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum Event {
        #[prost(message, tag = "1")]
        SessionOptions(super::StreamingOptions),
        #[prost(message, tag = "2")]
        Chunk(super::AudioChunk),
    }
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct Alternative {
    #[prost(string, tag = "2")]
    pub text: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct AlternativeUpdate {
    #[prost(message, repeated, tag = "1")]
    pub alternatives: Vec<Alternative>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct FinalRefinement {
    #[prost(int64, tag = "1")]
    pub final_index: i64,
    #[prost(oneof = "final_refinement::Type", tags = "2")]
    pub r#type: Option<final_refinement::Type>,
}

pub mod final_refinement {
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum Type {
        #[prost(message, tag = "2")]
        NormalizedText(super::AlternativeUpdate),
    }
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct StatusCode {
    #[prost(int32, tag = "1")]
    pub code_type: i32,
    #[prost(string, tag = "2")]
    pub message: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct StreamingResponse {
    #[prost(oneof = "streaming_response::Event", tags = "4, 5, 7, 8")]
    pub event: Option<streaming_response::Event>,
}

pub mod streaming_response {
    #[derive(Clone, PartialEq, ::prost::Oneof)]
    pub enum Event {
        #[prost(message, tag = "4")]
        Partial(super::AlternativeUpdate),
        #[prost(message, tag = "5")]
        Final(super::AlternativeUpdate),
        #[prost(message, tag = "7")]
        FinalRefinement(super::FinalRefinement),
        #[prost(message, tag = "8")]
        StatusCode(super::StatusCode),
    }
}

pub mod recognizer_client {
    use super::{StreamingRequest, StreamingResponse};
    use tonic::codegen::*;

    #[derive(Debug, Clone)]
    pub struct RecognizerClient<T> {
        inner: tonic::client::Grpc<T>,
    }

    impl RecognizerClient<tonic::transport::Channel> {
        pub async fn connect<D>(dst: D) -> Result<Self, tonic::transport::Error>
        where
            D: TryInto<tonic::transport::Endpoint>,
            D::Error: Into<StdError>,
        {
            let conn = tonic::transport::Endpoint::new(dst)?.connect().await?;
            Ok(Self::new(conn))
        }
    }

    impl<T> RecognizerClient<T>
    where
        T: tonic::client::GrpcService<tonic::body::BoxBody>,
        T::Error: Into<StdError>,
        T::ResponseBody: Body<Data = Bytes> + Send + 'static,
        <T::ResponseBody as Body>::Error: Into<StdError> + Send,
    {
        pub fn new(inner: T) -> Self {
            Self {
                inner: tonic::client::Grpc::new(inner),
            }
        }

        pub async fn recognize_streaming(
            &mut self,
            request: impl tonic::IntoStreamingRequest<Message = StreamingRequest>,
        ) -> Result<tonic::Response<tonic::codec::Streaming<StreamingResponse>>, tonic::Status>
        {
            self.inner.ready().await.map_err(|e| {
                tonic::Status::unknown(format!("service was not ready: {}", e.into()))
            })?;
            let codec = tonic::codec::ProstCodec::default();
            let path = http::uri::PathAndQuery::from_static(
                "/speechkit.stt.v3.Recognizer/RecognizeStreaming",
            );
            self.inner
                .streaming(request.into_streaming_request(), path, codec)
                .await
        }
    }
}
