import { filterSpots, SpotNotFoundError, SpotValidationError } from '../domain/spot.js';

export function createSpotService(repository) {
  const run = async (action, message) => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SpotValidationError || error instanceof SpotNotFoundError) throw error;
      throw new Error(message, { cause: error });
    }
  };
  return {
    list: (criteria) => run(() => repository.list(criteria), '地点を読み込めません。ブラウザの保存設定を確認して、もう一度読み込んでください。保存データは削除していません。'),
    filter: filterSpots,
    create: (input) => run(() => repository.create(input), '保存できませんでした。空き容量やブラウザの保存設定を確認し、もう一度保存してください。入力は残っています。'),
    update: (id, input) => run(() => repository.update(id, input), '変更を保存できませんでした。もう一度保存してください。入力は残っています。'),
    remove: (id) => run(() => repository.softDelete(id), '削除できませんでした。地点は一覧に残っています。もう一度試してください。'),
  };
}
