import {
  JSONRPCErrorResponse,
  JSONRPCResponse,
  JSONRPCSuccessResponse,
} from "@a2a-js/sdk";
import {
  A2AError,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";

type ExecutionContext = {
  waitUntil: (promise: Promise<any>) => void;
};

/**
 * Cloudflare Workersのメインエントリーポイント
 */
export function createServer<
  TEnv extends object,
  TExecutionContext extends ExecutionContext
>(requestHandler: DefaultRequestHandler) {
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler);
  return {
    async fetch(
      request: Request,
      env: TEnv,
      ctx: TExecutionContext
    ): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // ExpressのbaseUrlに相当する部分を考慮
      // 例えば、Workerが `https://a2a.worker.dev/` にデプロイされ、baseUrlが `/api` の場合、
      // パスは `/api/.well-known/agent.json` となります。
      // この例ではbaseUrlなしとして、直接パスを比較します。
      // let baseUrl = env.BASE_URL_PATH || ""; // 環境変数から取得する場合
      // if (path.startsWith(baseUrl)) {
      //   path = path.substring(baseUrl.length);
      // }

      // GET /.well-known/agent.json のハンドリング
      if (method === "GET" && path === "/.well-known/agent.json") {
        try {
          const agentCard = await requestHandler.getAgentCard();
          return new Response(JSON.stringify(agentCard), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        } catch (error: any) {
          console.error("Error fetching agent card:", error);
          const errorResponse = { error: "Failed to retrieve agent card" };
          return new Response(JSON.stringify(errorResponse), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          });
        }
      }

      // POST / のハンドリング (JSON-RPCリクエスト)
      if (method === "POST" && path === "/") {
        try {
          // Expressの`express.json()`ミドルウェアに相当する処理
          const requestBody = await request.json();

          const rpcResponseOrStream = await jsonRpcTransportHandler.handle(
            requestBody
          );

          // Server-Sent Events (SSE) のストリーミング処理
          if (
            typeof (rpcResponseOrStream as any)?.[Symbol.asyncIterator] ===
            "function"
          ) {
            const stream = rpcResponseOrStream as AsyncGenerator<
              JSONRPCSuccessResponse,
              void,
              undefined
            >;

            // WorkersのStreamingBodyでレスポンスを構築
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();

            ctx.waitUntil(
              (async () => {
                try {
                  for await (const event of stream) {
                    const sseData = `id: ${new Date().getTime()}\ndata: ${JSON.stringify(
                      event
                    )}\n\n`;
                    await writer.write(new TextEncoder().encode(sseData));
                  }
                } catch (streamError: any) {
                  console.error(`Error during SSE streaming:`, streamError);
                  // ストリームエラーをJSON-RPCエラー形式で処理
                  const a2aError =
                    streamError instanceof A2AError
                      ? streamError
                      : A2AError.internalError(
                          streamError.message || "Streaming error."
                        );
                  const errorResponse: JSONRPCErrorResponse = {
                    jsonrpc: "2.0",
                    id: requestBody?.id || null,
                    error: a2aError.toJSONRPCError(),
                  };
                  const sseErrorData = `id: ${new Date().getTime()}\nevent: error\ndata: ${JSON.stringify(
                    errorResponse
                  )}\n\n`;
                  await writer.write(new TextEncoder().encode(sseErrorData));
                } finally {
                  await writer.close();
                }
              })()
            );

            // レスポンスヘッダーの設定
            return new Response(readable, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            });
          } else {
            // 単一のJSON-RPCレスポンス
            const rpcResponse = rpcResponseOrStream as JSONRPCResponse;
            return new Response(JSON.stringify(rpcResponse), {
              headers: { "Content-Type": "application/json" },
              status: 200,
            });
          }
        } catch (error: any) {
          console.error("Unhandled error in POST handler:", error);
          // エラーレスポンスの生成
          const a2aError =
            error instanceof A2AError
              ? error
              : A2AError.internalError("General processing error.");
          const errorResponse: JSONRPCErrorResponse = {
            jsonrpc: "2.0",
            id: null, // リクエストボディのパースに失敗している可能性があるためnull
            error: a2aError.toJSONRPCError(),
          };
          return new Response(JSON.stringify(errorResponse), {
            headers: { "Content-Type": "application/json" },
            status: 500,
          });
        }
      }

      // どのルートにもマッチしない場合
      return new Response("Not Found", { status: 404 });
    },
  };
}
