import {
  getPool,
  getLLMService,
  clusterQuestions,
  findRepresentativeQuestion,
  type QuestionWithEmbedding
} from '@qaroot/shared';

interface AnalyzeQuestionsJob {
  session_id: string;
  iteration?: number | null;
}

export async function analyzeQuestionsWorker(job: AnalyzeQuestionsJob): Promise<void> {
  const { session_id, iteration } = job;

  if (iteration) {
    console.log(`[Worker] Starting analysis for session ${session_id}, iteration ${iteration}`);
  } else {
    console.log(`[Worker] Starting analysis for session ${session_id}`);
  }

  const pool = getPool();
  const llmService = getLLMService();

  try {
    // Fetch questions for this session (optionally filtered by iteration)
    const questionsResult = iteration
      ? await pool.query(
          'SELECT id, question_text, embedding, iteration FROM questions WHERE session_id = $1 AND iteration = $2 ORDER BY submitted_at ASC',
          [session_id, iteration]
        )
      : await pool.query(
          'SELECT id, question_text, embedding, iteration FROM questions WHERE session_id = $1 ORDER BY submitted_at ASC',
          [session_id]
        );

    const questions = questionsResult.rows;

    if (questions.length === 0) {
      console.log(`[Worker] No questions to analyze for session ${session_id}`);

      // Update session status
      await pool.query(
        'UPDATE sessions SET status = $1 WHERE id = $2',
        ['analyzed', session_id]
      );

      return;
    }

    console.log(`[Worker] Analyzing ${questions.length} questions`);

    // Step 1: Generate embeddings for questions that don't have them
    const questionsWithEmbeddings: QuestionWithEmbedding[] = [];

    for (const question of questions) {
      let embedding: number[];

      if (!question.embedding || (Array.isArray(question.embedding) && question.embedding.length === 0)) {
        console.log(`[Worker] Generating embedding for question ${question.id}`);

        try {
          embedding = await llmService.generateEmbedding(question.question_text);

          // Store embedding in database
          await pool.query('UPDATE questions SET embedding = $1 WHERE id = $2', [
            `[${embedding.join(',')}]`,  // Store as PostgreSQL array format
            question.id,
          ]);
        } catch (error) {
          console.error(`[Worker] Failed to generate embedding for question ${question.id}:`, error);
          // Skip this question if embedding generation fails
          continue;
        }
      } else if (typeof question.embedding === 'string') {
        // Parse JSON-encoded or PostgreSQL array format embedding
        embedding = JSON.parse(question.embedding);
      } else {
        embedding = question.embedding;
      }

      questionsWithEmbeddings.push({
        id: question.id,
        text: question.question_text,
        embedding,
      });
    }

    // Step 2: Cluster questions
    let clusters: any[] = [];

    if (questionsWithEmbeddings.length === 0) {
      console.log(`[Worker] No embeddings available, creating single cluster for all questions`);
      // Create a single cluster with all questions when embeddings aren't available
      clusters = [{
        questionIds: questions.map((q: any) => q.id),
        questions: questions.map((q: any) => q.question_text),
        size: questions.length,
      }];
    } else {
      // Use cosine similarity clustering when embeddings are available
      console.log(`[Worker] Clustering ${questionsWithEmbeddings.length} questions`);
      const similarityThreshold = parseFloat(process.env.CLUSTERING_THRESHOLD || '0.85');
      clusters = clusterQuestions(questionsWithEmbeddings, similarityThreshold);
    }

    console.log(`[Worker] Found ${clusters.length} clusters`);

    if (clusters.length === 0) {
      console.log(`[Worker] No clusters formed (all questions too different)`);
      return;
    }

    // Step 3: Process each cluster
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];

      console.log(`[Worker] Processing cluster ${i + 1}/${clusters.length} with ${cluster.size} questions`);

      // Find representative question (closest to centroid or first question)
      let representative: any;
      const clusterQuestions = questionsWithEmbeddings.filter((q) =>
        cluster.questionIds.includes(q.id)
      );

      if (clusterQuestions.length > 0) {
        representative = findRepresentativeQuestion(clusterQuestions);
      } else {
        // Fallback when no embeddings: use first question
        const firstQuestion = questions.find((q: any) => q.id === cluster.questionIds[0]);
        representative = { text: firstQuestion?.question_text || cluster.questions[0] };
      }

      // Generate LLM summary for this cluster
      let summary = '';
      let representativeQuestion = representative.text;

      if (cluster.size > 1) {
        try {
          const result = await llmService.summarizeQuestionCluster(cluster.questions);
          summary = result.summary;
          representativeQuestion = result.representative;
        } catch (error) {
          console.error(`[Worker] Failed to summarize cluster ${i + 1}:`, error);
          summary = `${cluster.size} similar questions`;
        }
      } else {
        summary = 'Single question';
      }

      // Store cluster in database (with iteration if specified)
      const questionIteration = questions.length > 0 ? questions[0].iteration || 1 : 1;
      const clusterResult = await pool.query(
        `INSERT INTO question_clusters
         (id, session_id, representative_question, cluster_label, question_count, iteration, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [session_id, representativeQuestion, summary, cluster.size, questionIteration]
      );

      const clusterId = clusterResult.rows[0].id;

      // Update questions with cluster_id
      for (const questionId of cluster.questionIds) {
        await pool.query(
          'UPDATE questions SET cluster_id = $1 WHERE id = $2',
          [clusterId, questionId]
        );
      }
    }

    // Step 4: Update session status
    await pool.query(
      'UPDATE sessions SET session_status = $1 WHERE id = $2',
      ['completed', session_id]
    );

    console.log(`[Worker] ✓ Analysis complete for session ${session_id}: ${clusters.length} clusters created`);
  } catch (error) {
    console.error(`[Worker] Analysis failed for session ${session_id}:`, error);

    // Update session with error status
    await pool.query(
      'UPDATE sessions SET session_status = $1 WHERE id = $2',
      ['completed', session_id]
    ).catch(err => console.error('Failed to update session status:', err));

    throw error;
  }
}
